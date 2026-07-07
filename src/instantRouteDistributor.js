const { INFO_RECOMMENDATION_TYPES } = require('./adaptiveContract');

const ROUTE_TO_INFO_META = {
  '/agendaPage':          { type: 'day_progress',       category: 'agenda',       source: 'isis',     priority: 'high' },
  '/cadernoCampoPage':    { type: 'field_notes_summary', category: 'caderno_campo', source: 'isis',  priority: 'high' },
  '/protocoloPage':       { type: 'basic_tip',          category: 'protocolo',    source: 'local_tip', priority: 'high' },
  '/lotePage':            { type: 'basic_tip',          category: 'lote',         source: 'local_tip', priority: 'medium' },
  '/relatoriosPage':      { type: 'day_progress',       category: 'geral',        source: 'local_tip', priority: 'low' },
  '/solucaoPage':         { type: 'today_cultivation',   category: 'solucao',      source: 'isis',     priority: 'medium' },
  '/areaCultivoPage':     { type: 'today_cultivation',   category: 'cultivo',      source: 'local_tip', priority: 'low' },
  '/reservatoriosPage':   { type: 'reservoir_report',    category: 'reservatorio', source: 'isis',     priority: 'medium' },
  '/gerenciarEquipePage': { type: 'basic_tip',          category: 'geral',        source: 'local_tip', priority: 'low' },
  '/historicoPage':       { type: 'day_progress',       category: 'geral',        source: 'local_tip', priority: 'low' },
  '/ajustesPage':         { type: 'basic_tip',          category: 'geral',        source: 'local_tip', priority: 'low' },
};

const ROUTE_DEFAULT_LABELS = {
  '/areaCultivoPage':       { title: 'Área de Cultivo',       description: 'Gerencie as áreas de cultivo.',            actionLabel: 'Abrir Cultivo' },
  '/reservatoriosPage':     { title: 'Reservatórios',         description: 'Acompanhe o nível dos reservatórios.',     actionLabel: 'Ver Reservatórios' },
  '/cadernoCampoPage':      { title: 'Caderno de Campo',      description: 'Registre e acompanhe o caderno de campo.',  actionLabel: 'Abrir Caderno' },
  '/solucaoPage':           { title: 'Solução',               description: 'Consulte a solução aplicada ao cultivo.',   actionLabel: 'Ver Solução' },
  '/protocoloPage':         { title: 'Protocolo',             description: 'Cadastre e gerencie protocolos.',           actionLabel: 'Abrir Protocolos' },
  '/agendaPage':            { title: 'Agenda',                description: 'Consulte suas atividades e tarefas.',       actionLabel: 'Abrir Agenda' },
  '/relatoriosPage':        { title: 'Relatórios',            description: 'Veja relatórios e resumos operacionais.',   actionLabel: 'Ver Relatórios' },
  '/ajustesPage':           { title: 'Ajustes',               description: 'Configure preferências do sistema.',        actionLabel: 'Abrir Ajustes' },
  '/gerenciarEquipePage':   { title: 'Equipe',                description: 'Gerencie a alocação da equipe.',            actionLabel: 'Gerenciar Equipe' },
  '/historicoPage':         { title: 'Histórico',             description: 'Consulte o histórico de atividades.',       actionLabel: 'Ver Histórico' },
  '/lotePage':              { title: 'Lotes',                 description: 'Consulte os lotes em produção.',            actionLabel: 'Ver Lotes' },
};

const INFO_TEMPLATES = {
  today_cultivation: {
    title: 'Cultivo de hoje',
    reason: 'Há uma ação de cultivo para priorizar agora.',
  },
  reservoir_report: {
    title: 'Resumo de reservatórios',
    reason: 'Há sinais de reservatório para acompanhar com atenção.',
  },
  day_progress: {
    title: 'Resumo do dia',
    reason: 'Há atividades do dia para acompanhar.',
  },
  field_notes_summary: {
    title: 'Resumo do caderno',
    reason: 'Há registros operacionais recentes para conferir.',
  },
  basic_tip: {
    title: 'Dica operacional',
    reason: 'Há um próximo passo seguro para continuar o fluxo.',
  },
};

function enrichFromSlot(enriched, slot) {
  if (!Array.isArray(enriched) || !enriched[slot] || typeof enriched[slot] !== 'object') {
    return {};
  }
  return enriched[slot];
}

function clampConfidence(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function distributeFromRanking({ ranking, enrichedRoutes, clientCapabilities, stepId, confidence }) {
  const maxShortcuts = Math.min(
    (clientCapabilities && clientCapabilities.maxShortcuts) || 4,
    4,
  );
  const baseConfidence = clampConfidence(confidence, 0.75);

  // Slot 0 — nextStepPrediction
  const primaryRoute = ranking[0];
  const enriched0 = enrichFromSlot(enrichedRoutes, 0);
  const default0 = ROUTE_DEFAULT_LABELS[primaryRoute] || { title: primaryRoute, description: '', actionLabel: 'Abrir' };
  const nextStep = {
    stepId: stepId || '',
    confidence: baseConfidence,
    title: enriched0.title || default0.title,
    description: enriched0.description || default0.description,
    targetRoute: primaryRoute,
    actionLabel: enriched0.actionLabel || default0.actionLabel,
  };

  // Slot 1 — infoRecommendation
  const infoRoute = ranking[1];
  const enriched1 = enrichFromSlot(enrichedRoutes, 1);
  const meta = ROUTE_TO_INFO_META[infoRoute] || { type: 'basic_tip', category: 'geral', source: 'local_tip', priority: 'low' };
  const template = INFO_TEMPLATES[meta.type] || INFO_TEMPLATES.basic_tip;
  const default1 = ROUTE_DEFAULT_LABELS[infoRoute] || { title: template.title };
  const infoRec = {
    type: meta.type,
    source: meta.source,
    priority: meta.priority,
    title: enriched1.title || default1.title,
    reason: enriched1.reason || template.reason,
    ctaRoute: infoRoute,
    category: meta.category,
  };

  // Slots 2+ — shortcuts (up to maxShortcuts)
  const shortcutSlots = ranking.slice(2, 2 + maxShortcuts);
  const shortcuts = shortcutSlots.map((route, i) => {
    const enriched = enrichFromSlot(enrichedRoutes, 2 + i);
    const defaults = ROUTE_DEFAULT_LABELS[route] || { title: route, description: '', actionLabel: 'Abrir' };
    return {
      route,
      confidence: baseConfidence * (1 - i * 0.12),
      label: enriched.actionLabel || enriched.title || defaults.actionLabel,
      description: enriched.description || defaults.description,
      group: i === 0 ? 'primary' : i === 1 ? 'secondary' : 'contextual',
      reason: enriched.reason || defaults.description,
    };
  });

  return { nextStep, infoRec, shortcuts };
}

module.exports = {
  ROUTE_TO_INFO_META,
  ROUTE_DEFAULT_LABELS,
  INFO_TEMPLATES,
  distributeFromRanking,
};
