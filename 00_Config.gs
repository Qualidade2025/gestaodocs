const APP = Object.freeze({
  NAME: 'Gestão de Documentos',
  VERSION: '4.9.3',
  SPREADSHEET_ID: '1P3pvuANM-GQvvV2GjJjuD05RzqxazRV7O6rBwrdvTSc',
  ROOT_FOLDER_ID: '1Sct90T0m0qGoS2Yz2x1W5MhJBQB-FWJ9',
  TIMEZONE: 'America/Sao_Paulo',
  SESSION_SECONDS: 8 * 60 * 60,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_SECONDS: 15 * 60,
  MAX_SOURCE_BYTES: 8 * 1024 * 1024
});

const SHEETS = Object.freeze({
  CONFIG: 'Configurações', SECTORS: 'Setores', USERS: 'Usuários', PEOPLE: 'Colaboradores',
  DOCS: 'Documentos', FLOWS: 'Fluxos', APPROVALS: 'Aprovações', EDITIONS: 'Edições',
  TRAININGS: 'Treinamentos', PARTICIPANTS: 'Participantes', AUDIT: 'Auditoria'
});

const HEADERS = Object.freeze({
  'Configurações': ['Chave','Valor','Descrição','AtualizadoEm'],
  'Setores': ['Id','Nome','Sigla','ResponsavelId','ResponsavelNome','Ativo','CriadoEm','AtualizadoEm','SupervisorId','SupervisorNome','AprovadorId','AprovadorNome'],
  'Usuários': ['Id','Usuario','Senha','Nome','Papeis','Setores','Ativo','TrocarSenha','CriadoEm','AtualizadoEm'],
  'Colaboradores': ['Id','Nome','Matricula','SetorId','Setor','Ativo','CriadoEm','AtualizadoEm','UserId'],
  'Documentos': ['Id','Codigo','Tipo','Titulo','SetorId','Setor','Edicao','Status','AutorId','AutorNome','ResponsavelId','ResponsavelNome','FonteFileId','PastaId','PdfFileId','CriadoEm','AtualizadoEm','PublicadoEm'],
  'Fluxos': ['Id','DocumentoId','Edicao','Ordem','UsuarioId','UsuarioNome','Status','Decisao','Comentario','Data'],
  'Aprovações': ['Id','DocumentoId','Edicao','UsuarioId','UsuarioNome','Decisao','Comentario','Data'],
  'Edições': ['Id','DocumentoId','Codigo','Edicao','Status','FonteFileId','PdfFileId','PublicadoEm','ObsoletoEm','AprovacoesJson'],
  'Treinamentos': ['Id','DocumentoId','Codigo','Edicao','SetorId','Setor','Tipo','Status','CriadoEm','ConcluidoEm'],
  'Participantes': ['Id','TreinamentoId','ColaboradorId','Colaborador','SetorId','Status','DataTreinamento','SupervisorId','Supervisor','Eficacia','DataEficacia','AvaliadorId','Avaliador','Observacao','AtualizadoEm','PrazoEficacia','PrazoProrrogado','Tipo'],
  'Auditoria': ['Id','Entidade','EntidadeId','Acao','UsuarioId','UsuarioNome','Detalhes','Data']
});

const DOC_SECTIONS = Object.freeze({
  POP: ['Objetivo','Aplicação','Definições','Responsabilidades','Procedimento','Registros e evidências','Referências'],
  IT: ['Objetivo','Materiais e EPI','Condições iniciais','Instruções passo a passo','Riscos e cuidados','Registros e evidências'],
  FOR: ['Conteúdo do formulário'],
  POL: ['Objetivo e compromisso','Abrangência','Princípios','Diretrizes','Responsabilidades','Comunicação e revisão','Referências']
});

function ok_(data) { return { ok: true, data: data == null ? null : data }; }
function fail_(message, code) { return { ok: false, error: { message: String(message || 'Erro inesperado.'), code: code || 'ERROR' } }; }
function publicCall_(fn) { try { return ok_(fn()); } catch (e) { console.error(e && e.stack ? e.stack : e); return fail_(e.message || e); } }
function uid_(prefix) { return (prefix || 'id') + '_' + Utilities.getUuid().replace(/-/g, ''); }
function now_() { return Utilities.formatDate(new Date(), APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss"); }
function normalize_(value) { return String(value == null ? '' : value).trim(); }
function bool_(value) { return value === true || /^(true|sim|1|ativo)$/i.test(normalize_(value)); }
function split_(value) { return normalize_(value).split(/[;,]/).map(function(x){return x.trim();}).filter(Boolean); }
function hasRole_(session, role) { return session.roles.indexOf(role) !== -1 || session.roles.indexOf('Manager') !== -1; }
function isManager_(session) { return session.roles.indexOf('Manager') !== -1; }
function isVisitor_(session) { return session.roles.indexOf('Visitante') !== -1; }
function canSector_(session, sectorId) { return isManager_(session) || session.sectors.indexOf('*') !== -1 || session.sectors.indexOf(String(sectorId)) !== -1; }
function sectorRole_(session, sectorId, idField) { const sector=findById_(SHEETS.SECTORS,sectorId); return !!sector&&String(sector[idField]||'')===String(session.id); }
function isSectorApprover_(session, sectorId) { return isManager_(session)||sectorRole_(session,sectorId,'AprovadorId'); }
function isSectorSupervisor_(session, sectorId) { return isSectorApprover_(session,sectorId)||sectorRole_(session,sectorId,'SupervisorId'); }
function isSectorResponsible_(session, sectorId) { return isSectorSupervisor_(session,sectorId)||sectorRole_(session,sectorId,'ResponsavelId'); }
function editionNumber_(edition) { return Number(String(edition || '').replace(/\D/g, '')) || 0; }
function editionLabel_(number) { return 'Ed. ' + String(Number(number || 1)).padStart(2, '0'); }
