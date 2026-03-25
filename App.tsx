import React from 'react';
import {StatusBar} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ChatProvider} from './src/store/chatStore';
import AppNavigator from './src/navigation/AppNavigator';
import {colors} from './src/theme';

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <StatusBar
          barStyle="light-content"
          backgroundColor={colors.background}
          translucent={false}
        />
        <ChatProvider>
          <AppNavigator />
        </ChatProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
