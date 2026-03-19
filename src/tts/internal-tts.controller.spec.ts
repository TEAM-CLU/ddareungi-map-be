import { InternalTtsController } from './internal-tts.controller';
import { TtsMetricsService } from './tts-metrics.service';

describe('InternalTtsController', () => {
  it('returns TTS counters and ratios', async () => {
    const ttsMetricsService = {
      snapshot: jest.fn().mockResolvedValue({
        counters: {
          tts_chunk_synthesized_total: 1,
          tts_merged_created_total: 2,
          tts_merged_cache_hit_total: 3,
          tts_merged_request_total: 4,
          tts_merged_repeat_request_total: 1,
        },
        ratios: {
          tts_merged_repeat_request_ratio: 0.25,
        },
      }),
    } as unknown as TtsMetricsService;

    const controller = new InternalTtsController(ttsMetricsService);
    const response = await controller.getMetrics();

    expect(response.data.counters.tts_merged_request_total).toBe(4);
    expect(response.data.ratios.tts_merged_repeat_request_ratio).toBe(0.25);
  });
});
