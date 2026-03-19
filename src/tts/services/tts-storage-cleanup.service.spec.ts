import { TtsStorageCleanupService } from './tts-storage-cleanup.service';
import {
  STORAGE_PATH_CHUNK_TEMPORARY,
  STORAGE_PATH_MERGED,
} from '../tts.constants';
import { StorageFileEntry, TtsStorageService } from './tts-storage.service';

describe('TtsStorageCleanupService', () => {
  const listStorageFilesMock = jest.fn();
  const removeStorageFilesMock = jest.fn();

  const ttsStorageService = {
    listStorageFiles: listStorageFilesMock,
    removeStorageFiles: removeStorageFilesMock,
  } as unknown as TtsStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-03-19T00:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes expired merged files after three days', async () => {
    listStorageFilesMock.mockImplementation((prefix: string) => {
      if (prefix === STORAGE_PATH_MERGED) {
        return Promise.resolve([
          createFile('merged/ko-KR/old.mp3', '2026-03-14T00:00:00.000Z'),
          createFile('merged/ko-KR/fresh.mp3', '2026-03-18T00:00:00.000Z'),
        ]);
      }

      return Promise.resolve([]);
    });

    const service = new TtsStorageCleanupService(ttsStorageService);
    await service.cleanupExpiredFiles();

    expect(removeStorageFilesMock).toHaveBeenCalledWith([
      'merged/ko-KR/old.mp3',
    ]);
  });

  it('removes expired temporary chunk files after thirty days', async () => {
    listStorageFilesMock.mockImplementation((prefix: string) => {
      if (prefix === STORAGE_PATH_CHUNK_TEMPORARY) {
        return Promise.resolve([
          createFile(
            'chunk-temporary/ko-KR/old.mp3',
            '2026-02-10T00:00:00.000Z',
          ),
          createFile(
            'chunk-temporary/ko-KR/fresh.mp3',
            '2026-03-10T00:00:00.000Z',
          ),
        ]);
      }

      return Promise.resolve([]);
    });

    const service = new TtsStorageCleanupService(ttsStorageService);
    await service.cleanupExpiredFiles();

    expect(removeStorageFilesMock).toHaveBeenCalledWith([
      'chunk-temporary/ko-KR/old.mp3',
    ]);
  });

  it('ignores files without a valid timestamp', async () => {
    listStorageFilesMock.mockResolvedValue([
      createFile('merged/ko-KR/no-date.mp3'),
      createFile('merged/ko-KR/bad-date.mp3', 'bad-date'),
    ]);

    const service = new TtsStorageCleanupService(ttsStorageService);
    await service.cleanupExpiredFiles();

    expect(removeStorageFilesMock).not.toHaveBeenCalled();
  });
});

function createFile(
  path: string,
  updatedAt?: string,
  createdAt?: string,
): StorageFileEntry {
  return {
    path,
    updatedAt,
    createdAt,
  };
}
