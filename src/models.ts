const commonProps = {
	object: "model",
	taskName: "Text Generation",
	taskDescription: "Family of generative text models, such as large language models (LLM), that can be adapted for a variety of natural language tasks.",
	inUse: true
} as const;

export const textGenerationModels: ModelType[] = [{
	...commonProps,
	id: "@cf/openai/gpt-oss-20b#text-generation",
	name: "@cf/openai/gpt-oss-20b",
	description: "OpenAI's open-weight models designed for powerful reasoning, agentic tasks, and versatile developer use cases – gpt-oss-20b is for lower latency, and local or specialized use-cases.",
}, {
	...commonProps,
	id: "@cf/openai/gpt-oss-120b#text-generation",
	name: "@cf/openai/gpt-oss-120b",
	description: "OpenAI's open-weight models designed for powerful reasoning, agentic tasks, and versatile developer use cases – gpt-oss-120b is for production, general purpose, high reasoning use-cases.",
}, {
	...commonProps,
	id: "@cf/meta/llama-3-8b-instruct#text-generation",
	name: "@cf/meta/llama-3-8b-instruct",
	description: "Generation over generation, Meta Llama 3 demonstrates state-of-the-art performance on a wide range of industry benchmarks and offers new capabilities, including improved reasoning.",
}, {
	...commonProps,
	id: "@cf/meta/llama-3.2-1b-instruct#text-generation",
	name: "@cf/meta/llama-3.2-1b-instruct",
	object: "model",
	description: "The Llama 3.2 instruction-tuned text only models are optimized for multilingual dialogue use cases, including agentic retrieval and summarization tasks.",
}, {
	...commonProps,
	id: "@cf/meta/llama-3.2-3b-instruct#text-generation",
	name: "@cf/meta/llama-3.2-3b-instruct",
	object: "model",
	description: "The Llama 3.2 instruction-tuned text only models are optimized for multilingual dialogue use cases, including agentic retrieval and summarization tasks.",
}, {
	...commonProps,
	id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast#text-generation",
	name: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	object: "model",
	description: "Llama 3.3 70B quantized to fp8 precision, optimized to be faster.",
}, {
	...commonProps,
	id: "@cf/mistral/mistral-7b-instruct-v0.1#text-generation",
	name: "@cf/mistral/mistral-7b-instruct-v0.1",
	object: "model",
	description: "Instruct fine-tuned version of the Mistral-7b generative text model with 7 billion parameters.",
}, {
	...commonProps,
	id: "@cf/qwen/qwen3-30b-a3b-fp8#text-generation",
	name: "@cf/qwen/qwen3-30b-a3b-fp8",
	object: "model",
	description: "Qwen3 30B model with fp8 quantization, optimized for tool calling and agentic workflows.",
}, {
	...commonProps,
	id: "@hf/mistral/mistral-7b-instruct-v0.2#text-generation",
	name: "@hf/mistral/mistral-7b-instruct-v0.2",
	object: "model",
	description: "(beta) The Mistral-7B-Instruct-v0.2 Large Language Model (LLM) is an instruct fine-tuned version of the Mistral-7B-v0.2. Mistral-7B-v0.2 has the following changes compared to Mistral-7B-v0.1: 32k context window (vs 8k context in v0.1), rope-theta = 1e6, and no Sliding-Window Attention.",
}, {
	...commonProps,
	id: "@cf/baai/bge-base-en-v1.5#text-embeddings",
	name: "@cf/baai/bge-base-en-v1.5",
	taskName: "Text Embeddings",
	object: "model",
	description: "BAAI general embedding (Base) model that transforms any given text into a 768-dimensional vector.",
	taskDescription: "<b>Note some tools recognize the embeddings models by their name end the word 'embedding'.</b> Feature extraction models transform raw data into numerical features that can be processed while preserving the information in the original dataset. These models are ideal as part of building vector search applications or Retrieval Augmented Generation workflows with Large Language Models (LLM)."
}];
