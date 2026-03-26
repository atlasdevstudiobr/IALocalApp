import React, {useEffect} from 'react';
import {StatusBar} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ChatProvider} from './src/store/chatStore';
import AppNavigator from './src/navigation/AppNavigator';
import {colors} from './src/theme';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import {loadPersistedLogs, logError, logInfo} from './src/services/logService';
import {loadModelDownloadState} from './src/services/modelDownloadService';

const TAG = 'App';

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

function App(): React.JSX.Element {
  useEffect(() => {
    void (async () => {
      logInfo(TAG, 'App startup iniciado');
      try {
        await loadPersistedLogs();
        logInfo(TAG, 'Restore de logs concluido');
      } catch (error) {
        logError(TAG, 'Restore de logs falhou', toErrorDetails(error));
      }

      try {
        logInfo(TAG, 'Restore de estado do modelo iniciado');
        const modelState = await loadModelDownloadState();
        logInfo(
          TAG,
          'Restore de estado do modelo concluido',
          `status=${modelState.status} path=${modelState.filePath}`,
        );
      } catch (error) {
        logError(TAG, 'Restore de estado do modelo falhou', toErrorDetails(error));
      }

      logInfo(TAG, 'App startup concluido');
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <StatusBar
          barStyle="light-content"
          backgroundColor={colors.background}
          translucent={false}
        />
        <AppErrorBoundary>
          <ChatProvider>
            <AppNavigator />
          </ChatProvider>
        </AppErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
