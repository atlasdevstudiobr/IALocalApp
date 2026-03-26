import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {installGlobalCrashHandling} from './src/services/crashService';
import {logInfo} from './src/services/logService';

logInfo('Bootstrap', 'Inicializacao do app iniciada em index.js');
installGlobalCrashHandling();
logInfo('Bootstrap', 'Inicializacao do app concluida em index.js');

AppRegistry.registerComponent(appName, () => App);
