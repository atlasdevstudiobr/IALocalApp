import {logError, logInfo, logWarn} from './logService';

const TAG = 'CrashService';

let handlersInstalled = false;

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? 'stack indisponivel'}`;
  }
  return String(error);
}

type ErrorUtilsType = {
  getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

function installGlobalJsErrorHandler(): void {
  const errorUtils = (global as {ErrorUtils?: ErrorUtilsType}).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) {
    logWarn(TAG, 'Global JS handler indisponivel neste runtime');
    return;
  }

  const previousHandler = errorUtils.getGlobalHandler?.();

  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    logError(
      TAG,
      'Global JS error capturado',
      `fatal=${Boolean(isFatal)}\n${toErrorDetails(error)}`,
    );

    // Em fatal JS, nao delega para evitar encerramento silencioso do app.
    if (!isFatal && previousHandler) {
      previousHandler(error, isFatal);
    }
  });

  logInfo(TAG, 'Global JS error handler instalado');
}

function installPromiseRejectionHandlers(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rejectionTracking = require('promise/setimmediate/rejection-tracking');
    rejectionTracking.enable({
      allRejections: true,
      onUnhandled: (_id: number, error: unknown) => {
        logError(TAG, 'Unhandled promise rejection capturada', toErrorDetails(error));
      },
      onHandled: (id: number) => {
        logInfo(TAG, 'Promise rejection marcada como tratada', `id=${id}`);
      },
    });
    logInfo(TAG, 'Promise rejection tracking instalado via polyfill');
  } catch (error) {
    logWarn(
      TAG,
      'Falha ao instalar promise rejection tracking via polyfill',
      toErrorDetails(error),
    );
  }

  try {
    const scope = globalThis as {
      addEventListener?: (
        name: string,
        listener: (event: {reason?: unknown}) => void,
      ) => void;
    };
    if (typeof scope.addEventListener === 'function') {
      scope.addEventListener('unhandledrejection', event => {
        logError(
          TAG,
          'Unhandled promise rejection capturada via event listener',
          toErrorDetails(event?.reason),
        );
      });
      logInfo(TAG, 'Promise rejection listener instalado via addEventListener');
    }
  } catch (error) {
    logWarn(
      TAG,
      'Falha ao instalar promise rejection listener via addEventListener',
      toErrorDetails(error),
    );
  }
}

export function installGlobalCrashHandling(): void {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;
  logInfo(TAG, 'Instalacao de handlers globais de crash iniciada');
  installGlobalJsErrorHandler();
  installPromiseRejectionHandlers();
  logInfo(TAG, 'Instalacao de handlers globais de crash concluida');
}
