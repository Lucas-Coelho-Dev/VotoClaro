// packages/shared/src/types.ts
// Tipos compartilhados entre API e Web

export type ConfidenceLevel = 'OFFICIAL' | 'SEMI_STRUCTURED' | 'AUXILIARY' | 'UNVERIFIED';
export type CandidateStatus = 'DEFERIDA' | 'INDEFERIDA' | 'CASSADA' | 'RENUNCIADA' | 'FALECIDA' | 'PENDENTE';
export type EventType =
  | 'CANDIDATURA_REGISTRADA' | 'CANDIDATURA_DEFERIDA' | 'CANDIDATURA_INDEFERIDA'
  | 'CANDIDATURA_CASSADA' | 'CANDIDATURA_RENUNCIADA'
  | 'PROPAGANDA_REGISTRADA' | 'DECISAO_JUDICIAL'
  | 'CONTA_ENTREGUE' | 'CONTA_APROVADA' | 'CONTA_REPROVADA'
  | 'RECURSO_INTERPOSTO' | 'MARCO_CAMPANHA';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DataSource {
  name: string;
  url: string;
  confidence: ConfidenceLevel;
  lastSync: string; // ISO date
  description: string;
}

export interface CandidateListItem {
  id: string;
  tseId: string;
  ballotName: string;
  fullName: string;
  ballotNumber: number;
  position: string;
  state: string;
  city?: string;
  partyAcronym?: string;
  partyName?: string;
  status: CandidateStatus;
  photoUrl?: string;
  electionYear: number;
}

export interface CandidateDetail extends CandidateListItem {
  sequentialCode: string;
  birthYear?: number;
  gender?: string;
  occupation?: string;
  educationLevel?: string;
  coalition?: string;
  federationName?: string;
  isReelectionCandidate: boolean;
  socialMedia: SocialMediaItem[];
  assets: AssetItem[];
  financeSummary?: FinanceSummaryItem;
  electionResults: ElectionResultItem[];
  sources: DataSource[];
  lastSyncAt?: string;
}

export interface SocialMediaItem {
  platform: string;
  url: string;
  handle?: string;
}

export interface AssetItem {
  type: string;
  description: string;
  value: number;
  order: number;
}

export interface FinanceSummaryItem {
  totalRevenue: number;
  totalExpense: number;
  balance: number;
  lastUpdated: string;
  confidence: ConfidenceLevel;
  sourceUrl?: string;
}

export interface FinanceTransactionItem {
  id: string;
  type: 'RECEITA' | 'DESPESA';
  date: string;
  amount: number;
  category: string;
  subcategory?: string;
  description?: string;
  donorName?: string;
  supplierName?: string;
  supplierCnpj?: string;
  confidence: ConfidenceLevel;
  sourceUrl?: string;
}

export interface TimelineEventItem {
  id: string;
  candidateId?: string;
  candidateName?: string;
  eventType: EventType;
  title: string;
  description?: string;
  eventDate: string;
  sourceUrl: string;
  sourceName: string;
  confidence: ConfidenceLevel;
}

export interface ElectionResultItem {
  votes: number;
  percentage?: number;
  elected: boolean;
  round: number;
  position?: number;
}

export interface SearchFilters {
  q?: string;
  position?: string;
  state?: string;
  city?: string;
  partyAcronym?: string;
  electionYear?: number;
  status?: CandidateStatus;
  page?: number;
  pageSize?: number;
}

export interface ComparisonResult {
  candidates: CandidateDetail[];
  comparisonDate: string;
  disclaimer: string;
}

export interface VerificationEntry {
  field: string;
  value?: string;
  sourceName: string;
  sourceUrl: string;
  checksum?: string;
  confidence: ConfidenceLevel;
  syncedAt: string;
}

export interface SyncJobStatus {
  id: string;
  connector: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL';
  startedAt?: string;
  finishedAt?: string;
  recordsIn?: number;
  recordsOut?: number;
  errorCount?: number;
  lastError?: string;
}

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  OFFICIAL: 'Fonte oficial',
  SEMI_STRUCTURED: 'Parcialmente estruturado',
  AUXILIARY: 'Fonte auxiliar',
  UNVERIFIED: 'Não verificado',
};

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  OFFICIAL: '#16a34a',
  SEMI_STRUCTURED: '#d97706',
  AUXILIARY: '#2563eb',
  UNVERIFIED: '#dc2626',
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  CANDIDATURA_REGISTRADA: 'Candidatura registrada',
  CANDIDATURA_DEFERIDA: 'Candidatura deferida',
  CANDIDATURA_INDEFERIDA: 'Candidatura indeferida',
  CANDIDATURA_CASSADA: 'Candidatura cassada',
  CANDIDATURA_RENUNCIADA: 'Candidatura renunciada',
  PROPAGANDA_REGISTRADA: 'Propaganda registrada',
  DECISAO_JUDICIAL: 'Decisão judicial',
  CONTA_ENTREGUE: 'Contas entregues',
  CONTA_APROVADA: 'Contas aprovadas',
  CONTA_REPROVADA: 'Contas reprovadas',
  RECURSO_INTERPOSTO: 'Recurso interposto',
  MARCO_CAMPANHA: 'Marco de campanha',
};

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  DEFERIDA: 'Candidatura deferida',
  INDEFERIDA: 'Candidatura indeferida',
  CASSADA: 'Candidatura cassada',
  RENUNCIADA: 'Candidatura renunciada',
  FALECIDA: 'Candidato falecido',
  PENDENTE: 'Análise pendente',
};
