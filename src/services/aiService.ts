import {Message} from '../types';
import {logInfo, logWarn} from './logService';

const TAG = 'AIService';

/**
 * Stub response returned when no model is loaded.
 */
const STUB_RESPONSE =
  '\u2699\uFE0F Modelo local ainda nao instalado. Acesse Configuracoes para instalar o modelo Qwen2.5-3B.';

/**
 * Flag to simulate whether a model is loaded.
 * When llama.cpp is integrated, replace this with actual model state.
 */
let isModelLoaded = false;

/**
 * Generates a response from the AI model.
 *
 * Currently returns a stub response indicating the model is not yet installed.
 * This function is structured to be replaced with llama.cpp/ggml integration.
 *
 * @param messages - The conversation history to send to the model
 * @returns Promise resolving to the assistant's response text
 */
export async function generateResponse(messages: Message[]): Promise<string> {
  const lastMessage = messages[messages.length - 1];
  logInfo(
    TAG,
    `generateResponse called with ${messages.length} message(s)`,
    `Last message role: ${lastMessage?.role ?? 'none'}`,
  );

  if (!isModelLoaded) {
    logWarn(TAG, 'Model not loaded, returning stub response');

    // Simulate network/processing delay
    await new Promise<void>(resolve => setTimeout(resolve, 500));

    return STUB_RESPONSE;
  }

  // -------------------------------------------------------------------------
  // TODO: Replace this block with llama.cpp integration
  //
  // Example future integration:
  //
  //   const context = await LlamaContext.create({
  //     model: modelFilePath,
  //     n_ctx: 2048,
  //   });
  //
  //   const prompt = formatMessagesAsPrompt(messages);
  //   const result = await context.completion({ prompt, n_predict: 512 });
  //   return result.text;
  //
  // -------------------------------------------------------------------------

  return STUB_RESPONSE;
}

/**
 * Checks whether the AI model is currently loaded and ready.
 */
export function isAIReady(): boolean {
  return isModelLoaded;
}

/**
 * Marks the model as loaded (for future use when model loading is implemented).
 */
export function setModelLoaded(loaded: boolean): void {
  isModelLoaded = loaded;
  logInfo(TAG, `Model loaded state set to: ${loaded}`);
}

/**
 * Returns model info for display purposes.
 */
export function getModelInfo() {
  return {
    name: 'Qwen2.5-3B-Instruct-Q4_K_M',
    displayName: 'Qwen2.5-3B-Instruct Q4_K_M',
    sizeGB: 2.0,
    isLoaded: isModelLoaded,
  };
}
