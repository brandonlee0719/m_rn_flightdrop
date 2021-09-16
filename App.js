import lodash from 'lodash';
import React, { Component } from 'react';
import { AsyncStorage, WebView, Platform, Linking, View } from 'react-native';
import OneSignal from 'react-native-onesignal';
import { StackActions, NavigationActions } from 'react-navigation';
import { isIphoneX, getStatusBarHeight } from 'react-native-iphone-x-helper';
import { Provider } from 'react-redux';
import store from './src/store';
import AppWithNavigationState from './src/services/navigation/container';
import { createUser, initPatchUser, get } from './src/services/api/user';
import { initNotifiedDeals, updateNotifiedDeals } from './src/services/api/localStorage';
import { Splash } from './src/scenes/Splash';

import { initWatchedDeals } from './src/data/deals/utils';
import { initWatchingLocations } from './src/data/locations/utils';
import firebaseApp from './FBAnalytics';
import * as Storage from './src/services/storage';

console.disableYellowBox = true;

const INITIAL_USER_DATA = {
  level: 0,
  miles: 0,
  streak: 0,
  departures: [],
  watchLocations: [],
  favoriteDeals: [],
  playerId: null,
};

export default class App extends Component {
  state = { user: INITIAL_USER_DATA, webView: null };

  async componentDidMount() {
    let tokenForSwiftVersion = null;
    if (Platform.OS === 'ios') {
      const UserDefaults = require('react-native-userdefaults-ios');
      tokenForSwiftVersion = await UserDefaults.stringForKey('USER_TOKEN');
      if (tokenForSwiftVersion !== null) {
        await AsyncStorage.setItem('token', tokenForSwiftVersion);
        await UserDefaults.removeItemForKey('USER_TOKEN');
        const userObj = await get();

        await AsyncStorage.setItem('userLocal', JSON.stringify(userObj));
        this.setState({ webView: false });
        await updateNotifiedDeals();
        return;
      }
    }

    const token = await AsyncStorage.getItem('token');
    if (token != null) {
      const userObj = await get();

      await AsyncStorage.setItem('userLocal', JSON.stringify(userObj));

      this.setState({ webView: false });
      await updateNotifiedDeals();

    } else {
      this.setState({ webView: true });

      setTimeout(() => {
        if (this.webview) {
          this.webview.postMessage(JSON.stringify({ isIphoneX: isIphoneX(), isAndroid: Platform.OS === 'android' }));
        }
      }, 3000);

      firebaseApp.analytics().logEvent('startedOnboarding', {});
    }
  }

  navigateToDealDetail = (deal_id) => {
    const resetNotification = NavigationActions.navigate({ routeName: 'detailContainer', params: { deal_id } });
    this.navigator && this.navigator.dispatch(resetNotification);
  }

  getOneSignalPlayerId = () => {
    OneSignal.init('96783218-df0f-496e-bbaa-92ff825ee01f');
    OneSignal.configure();

    if (Platform.OS === 'ios') {
      OneSignal.promptForPushNotificationsWithUserResponse((response) => {
        this.webview.postMessage(JSON.stringify({ notificationAllowed: response }));
      });
    } else {
      this.webview.postMessage(JSON.stringify({ notificationAllowed: true }));
    }

    const onIds = async (device) => {
      await Storage.OneSignalPlayerId.set(device.userId);
    };

    const onReceived = (notification) => {
      const deal_id = lodash.get(notification, 'payload.additionalData.deal_id', null);
      if (deal_id) {
        this.navigateToDealDetail(deal_id);
      }
    };

    const onOpened = (openResult) => {
      const deal_id = lodash.get(openResult, 'notification.payload.additionalData.deal_id', null);
      if (deal_id) {
        this.navigateToDealDetail(deal_id);
      }
    };

    OneSignal.addEventListener('received', onReceived);
    OneSignal.addEventListener('opened', onOpened);
    OneSignal.addEventListener('ids', onIds);
  };

  getOneSignalPlayerIdStatic = () => Storage.OneSignalPlayerId.get()
    .then((result) => {
      if (result) return result;
      return OneSignal.getPermissionSubscriptionState(status => status.userId);
    })
    .catch(() => OneSignal.getPermissionSubscriptionState(status => status.userId));

  finishedOnboarding = async () => {
    // @TODO: convert await to Promise.all
    // 1. Get OneSignal PlayerId
    const playerId = await this.getOneSignalPlayerIdStatic();
    this.setState({ user: { ...this.state.user, playerId } });

    // 2. Call /auth to create user and get token
    await createUser(playerId); // This saves token to storage

    // 3. Send PATCH update to update user preferences
    AsyncStorage.setItem('userLocal', JSON.stringify(this.state.user));
    await initPatchUser(this.state.user); // PATCH user data from onBoarding WebView

    // 5. Load deals
    await updateNotifiedDeals();
    this.setState({ webView: false }); // Close webview
    initWatchedDeals();
    initNotifiedDeals();
    initWatchingLocations();
    firebaseApp.analytics().logEvent('completedOnboarding', {});
    firebaseApp.analytics().logEvent('startApp', {});
    firebaseApp.analytics().setAnalyticsCollectionEnabled(true);
  };

  // This gets called whenever webview fires an event
  onWebviewMessage = (event) => {
    const data = JSON.parse(event.nativeEvent.data);
    this.setState({ user: { ...this.state.user, ...data } });

    if (data.allowNotifications) {
      this.getOneSignalPlayerId();
    }

    if (data.allowNotificationsTwice) {
      Linking.openURL('app-settings:');
    }

    if (data.onboardingFinished) {
      this.finishedOnboarding();
    }
  };

  renderLoading = () => <Splash />;

  render() {
    if (this.state.webView) {
      return (
        <View style={{ flex: 1 }}>
          {
            isIphoneX() &&
            <View style={{
              height: getStatusBarHeight(),
              backgroundColor: '#FF5F63',
            }}
            />
          }
          <WebView
            ref={r => this.webview = r}
            source={{ uri: Platform.OS === 'ios' ? './webView-rn/index.html' : 'file:///android_asset/webView-rn/index.html' }}
            onMessage={this.onWebviewMessage}
            startInLoadingState
            javaScriptEnabled
            mixedContentMode="always"
            thirdPartyCookiesEnabled
            allowUniversalAccessFromFileURLs
            style={{ backgroundColor: '#00000000' }}
          // renderLoading={this.renderLoading}
          />
        </View>
      );
    } else if (this.state.webView === false) {
      return (
        <Provider store={store}>
          <AppWithNavigationState onRef={(ref) => {
            this.navigator = ref;
          }}
          />
        </Provider>
      );
    }
    return null;
  }
}
