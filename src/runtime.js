const config = require('./config');
const { SnapshotStore } = require('./persistence');
const { OfficialDataSync } = require('./official-sync');
const { LegislativeService } = require('./legislative');
const { CandidatePhotoSync } = require('./photo-sync');
const { GeographyService } = require('./geography');
const { GovernmentPlanService } = require('./government-plans');
const { GovernmentPlanSummaryService, THEMES } = require('./plan-summary');
const { LocalLlmClient } = require('./local-llm');
const { CandidateIdentityVault, IntegrityService } = require('./integrity');

const store = new SnapshotStore(config);
const photoSynchronizer = new CandidatePhotoSync(config, store);
const legislativeService = new LegislativeService(config, store);
const identityVault = new CandidateIdentityVault();
const synchronizer = new OfficialDataSync(config, store, photoSynchronizer, identityVault);
const geographyService = new GeographyService(config);
const governmentPlanService = new GovernmentPlanService(config);
const localLlmClient = new LocalLlmClient(config, THEMES);
const governmentPlanSummaryService = new GovernmentPlanSummaryService(
  config,
  governmentPlanService,
  store,
  localLlmClient,
);
const integrityService = new IntegrityService(config, identityVault);
let initialization = null;

async function initializeRuntime() {
  if (!initialization) {
    initialization = store.initialize().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

module.exports = {
  config,
  store,
  synchronizer,
  photoSynchronizer,
  legislativeService,
  geographyService,
  governmentPlanService,
  governmentPlanSummaryService,
  localLlmClient,
  identityVault,
  integrityService,
  initializeRuntime,
};
