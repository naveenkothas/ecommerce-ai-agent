import { Router, Request, Response } from 'express';
import { streamText, type CoreMessage, InvalidToolArgumentsError } from 'ai';
import { agentTools, checkOllamaHealth, createOllamaModel, SYSTEM_PROMPT } from '../agent';

const router = Router();

const MAX_MESSAGE_LENGTH = Number(process.env.AGENT_MAX_MESSAGE_LENGTH) || 2000;
const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS) || 10;

/**
 * POST /api/agent/chat
 *
 * Accepts the AI SDK UI (useChat) message format and streams a response
 * using the Vercel AI SDK data stream protocol — compatible with the
 * frontend useChat hook out of the box.
 */
router.post('/chat', async (req: Request, res: Response): Promise<void> => {
  const { messages } = req.body as { messages?: CoreMessage[] };

  // ── Input validation ────────────────────────────────────────────────────────
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'messages array is required and must not be empty' },
    });
    return;
  }

  const lastMessage = messages[messages.length - 1];
  const lastContent =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content);

  if (lastContent.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`,
      },
    });
    return;
  }

  // ── Pre-flight: ensure Ollama is reachable ──────────────────────────────────
  const health = await checkOllamaHealth();
  if (!health.ok) {
    res.status(503).json({
      success: false,
      error: {
        code: 'AGENT_UNAVAILABLE',
        message: health.error ?? 'Agent service unavailable. Ensure Ollama is running.',
      },
    });
    return;
  }

  // ── Stream response ─────────────────────────────────────────────────────────
  try {
    const model = createOllamaModel();

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools: agentTools,
      maxSteps: MAX_STEPS,
      onError: ({ error }) => {
        if (error instanceof InvalidToolArgumentsError) {
          // LLM sent wrong arg names — log the mismatch, stream will self-recover on retry
          console.warn(
            '[Agent] InvalidToolArgumentsError for tool "%s": %s',
            error.toolName,
            error.message,
          );
        } else {
          console.error('[Agent] Streaming error:', error);
        }
      },
    });

    result.pipeDataStreamToResponse(res, {
      getErrorMessage: () =>
        'The assistant encountered an unexpected error. Please try again.',
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Agent] Failed to start stream:', e.message);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to start agent. Please try again.',
        },
      });
    }
  }
});

export default router;
