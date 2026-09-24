import { afterEach, describe, expect, jest, test } from '@jest/globals';
import Material from '../../models/Material.js';
import FileService from '../../services/fileService.js';
import processingJobs from '../../services/processingJobService.js';
import agendaJobs from '../../services/jobQueueService.js';
process.env.RAG_SKIP_AUTO_INIT = 'true';
const { default: ragService } = await import('../../services/ragService.js');

afterEach(() => jest.restoreAllMocks());

describe('material processing consumers', () => {
  test('partial embedding never becomes completed in the in-process queue', async () => {
    const statuses = [];
    const material = {
      _id: 'material', save: jest.fn(),
      updateProcessingStatus: jest.fn(async status => { statuses.push(status); })
    };
    jest.spyOn(Material, 'findById').mockResolvedValue(material);
    jest.spyOn(ragService, 'processAndEmbedMaterial').mockResolvedValue({ success: false, partial: true, error: 'Material indexing incomplete: 2 of 3 chunks embedded.' });
    const job = { id: 'qa-job', materialId: 'material', retryCount: 0, maxRetries: 1 };
    await processingJobs.processJob(job);
    expect(statuses).toEqual(['processing', 'failed']);
    expect(material.save).not.toHaveBeenCalled();
    expect(job.status).toBe('failed');
    processingJobs.processedJobs.delete(job.id);
  });

  test('Agenda retains the original source after success for previews and reprocessing', async () => {
    const processors = new Map();
    const previousAgenda = agendaJobs.agenda;
    agendaJobs.agenda = { define: (name, handler) => processors.set(name, handler) };
    agendaJobs.defineJobs();
    const material = { _id: 'material', name: 'Fixture', filePath: '/tmp/qa-source.pdf', markAsCompleted: jest.fn(), markAsFailed: jest.fn() };
    jest.spyOn(Material, 'findById').mockResolvedValue(material);
    jest.spyOn(ragService, 'processAndEmbedMaterial').mockResolvedValue({ success: true, chunksCount: 3 });
    const deleteFile = jest.spyOn(FileService, 'deleteFile').mockResolvedValue();
    try {
      await processors.get('process-material')({ attrs: { data: { materialId: 'material' } } });
      expect(material.markAsCompleted).toHaveBeenCalled();
      expect(deleteFile).not.toHaveBeenCalled();
      expect(material.filePath).toBe('/tmp/qa-source.pdf');
    } finally {
      agendaJobs.agenda = previousAgenda;
    }
  });
});
