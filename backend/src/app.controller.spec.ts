import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('返回包含服务状态和可解析时间的健康信息', () => {
      const result = appController.getHello();
      expect(result).toEqual(expect.objectContaining({
        status: 'running',
        version: expect.any(String),
        features: expect.arrayContaining(['智能记账']),
      }));
      expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
    });
  });
});
