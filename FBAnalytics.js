import firebase from 'react-native-firebase';

const firebaseApp = firebase.initializeApp({ debug: false });
if (__DEV__) {
  firebaseApp.config().enableDeveloperMode();
}
export default firebaseApp;
