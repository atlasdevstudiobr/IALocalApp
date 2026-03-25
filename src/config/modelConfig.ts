export const LOCAL_MODEL_ID = 'qwen2.5-3b-instruct-q4_k_m';

export const LOCAL_MODEL_DISPLAY_NAME = 'Qwen2.5-3B-Instruct Q4_K_M';

export const LOCAL_MODEL_FILE_NAME = 'qwen2.5-3b-instruct-q4_k_m.gguf';

/**
 * URL configuravel para o download do modelo GGUF.
 * Troque apenas este valor quando precisar apontar para outro host/arquivo.
 */
export const LOCAL_MODEL_DOWNLOAD_URL =
  'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf?download=true';

export const LOCAL_MODEL_ESTIMATED_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Limite minimo plausivel para evitar marcar arquivos truncados como validos.
 */
export const LOCAL_MODEL_MIN_VALID_SIZE_BYTES = 1024 * 1024 * 1024;
