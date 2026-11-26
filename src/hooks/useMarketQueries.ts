import { useMutation, useQuery } from '@tanstack/react-query';
import type { Exchange, ManualStockPayload } from '../types/market';
import {
  analyzeDocuments,
  analyzeManualStock,
  analyzeStock,
  fetchMarketLive,
  fetchTopPicks,
} from '../services/apiClient';
import { getBDMarketSession } from '../utils/bdMarketSession';
import { QuotaExceededError } from '../services/quotaService';

export function useMarketLive() {
  const session = getBDMarketSession();
  return useQuery({
    queryKey: ['market-live'],
    queryFn: fetchMarketLive,
    staleTime: 60_000,
    refetchInterval: session.is_live ? 60_000 : false,
  });
}

export function useTopPicks() {
  const session = getBDMarketSession();
  return useQuery({
    queryKey: ['top-picks', session.mode],
    queryFn: fetchTopPicks,
    staleTime: session.is_live ? 120_000 : 15 * 60_000,
    retry: 2,
    retryDelay: 2_500,
  });
}

export function useStockAnalysis(symbol: string, exchange: Exchange, enabled = true) {
  const cleanSym = symbol.trim().toUpperCase();
  return useQuery({
    queryKey: ['stock-analysis', exchange, cleanSym],
    queryFn: () => analyzeStock(cleanSym, exchange),
    enabled: enabled && cleanSym.length > 0,
    staleTime: 180_000,
    retry: (failureCount, error) => !(error instanceof QuotaExceededError) && failureCount < 1,
  });
}

export function useManualAnalysisMutation() {
  return useMutation({
    mutationFn: (payload: ManualStockPayload) => analyzeManualStock(payload),
  });
}

export function useDocumentAnalysisMutation() {
  return useMutation({
    mutationFn: ({ files, symbol, exchange }: { files: File[]; symbol: string; exchange: Exchange }) =>
      analyzeDocuments(files, symbol, exchange),
  });
}
