/**
 * 预算 API 服务
 */
import { httpService } from '../http';
import type {
  BudgetData,
  CreateBudgetDto,
  UpdateBudgetDto,
  BudgetProgress,
} from '../../types/budget';
import type { ApiResponse } from '../../types/api';
import type { LedgerFacts } from './ledger';

export interface LedgerBudgetProgress {
  id: number; name: string; amount: string; period: 'monthly' | 'yearly';
  categoryId: number | null;
  category: { id: number; name: string; icon?: string | null } | null;
  alertAt: number; updatedAt: string;
  configurationBasis: 'current'; spendingBasis: 'gross_expense';
  ledger: LedgerFacts; spent: string; refundInflow: string;
  remaining: string | null; progressPercent: string | null;
  comparisonStatus: 'complete' | 'incomplete' | 'invalid_budget';
  confirmedOverBudget: boolean | null; isOverBudget: boolean | null; needsAlert: boolean;
}

// Bind reads and writes to the session that opened the screen, including delayed confirmations.
export function createBudgetApi(token: string) {
  const config = { headers: { Authorization: `Bearer ${token}` } };
  async function write(request: Promise<any>, requiresCount = false) {
    const response = await request;
    if (response?.success === false) throw new Error(response.message || '预算保存失败');
    const data = response?.data ?? response;
    if (requiresCount && data?.count !== 1) throw new Error('预算已不存在，请刷新后重试');
    return data;
  }
  return {
    async progress(): Promise<LedgerBudgetProgress[]> {
      const response = await httpService.get<LedgerBudgetProgress[]>('/budgets/ledger-progress', config);
      if (!response.success || !Array.isArray(response.data)) throw new Error(response.message || '预算加载失败');
      return response.data;
    },
    create: (data: CreateBudgetDto) => write(httpService.post('/budgets', data, config)),
    update: (id: number, data: UpdateBudgetDto) => write(httpService.patch(`/budgets/${id}`, data, config), true),
    remove: (id: number) => write(httpService.delete(`/budgets/${id}`, config), true),
  };
}

class BudgetsService {
  private basePath = '/budgets';

  async getAll(): Promise<ApiResponse<BudgetData[]>> {
    return httpService.get<BudgetData[]>(this.basePath);
  }

  async getById(id: number): Promise<ApiResponse<BudgetData>> {
    return httpService.get<BudgetData>(`${this.basePath}/${id}`);
  }

  async create(data: CreateBudgetDto): Promise<ApiResponse<BudgetData>> {
    return httpService.post<BudgetData>(this.basePath, data);
  }

  async update(id: number, data: UpdateBudgetDto): Promise<ApiResponse<void>> {
    return httpService.patch<void>(`${this.basePath}/${id}`, data);
  }

  async delete(id: number): Promise<ApiResponse<void>> {
    return httpService.delete<void>(`${this.basePath}/${id}`);
  }

  async getProgress(): Promise<ApiResponse<BudgetProgress[]>> {
    return httpService.get<BudgetProgress[]>(`${this.basePath}/progress`);
  }
}

export const budgetsService = new BudgetsService();
