function configurarPlataforma() {
  return publicCall_(function() {
    const props = PropertiesService.getScriptProperties();
    props.setProperties({ SPREADSHEET_ID: APP.SPREADSHEET_ID, ROOT_FOLDER_ID: APP.ROOT_FOLDER_ID, APP_VERSION: APP.VERSION }, false);
    const ss = SpreadsheetApp.openById(APP.SPREADSHEET_ID);
    Object.keys(HEADERS).forEach(function(name) { ensureSheet_(ss, name, HEADERS[name]); });
    const folders = ensureFolderStructure_();
    upsertConfig_('ROOT_FOLDER_ID', APP.ROOT_FOLDER_ID, 'Pasta principal do Drive');
    Object.keys(folders).forEach(function(key) { upsertConfig_('FOLDER_' + key, folders[key], 'Criado automaticamente'); });
    seedDefaults_();
    migrateSectorRoles_();
    migratePurchaseSectorCode_();
    syncSectorUsers_();
    detachAutomaticCollaborators_();
    migrateTrainingRules_();
    migrateFailedEfficacyUpdates_();
    SpreadsheetApp.flush();
    return { message: 'Plataforma configurada com sucesso.', spreadsheet: ss.getName(), folders: folders, initialUser: 'admin', initialPassword: 'admin123' };
  });
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else {
    const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getDisplayValues()[0];
    headers.forEach(function(header, index) { if (!existing[index]) sh.getRange(1, index + 1).setValue(header); });
  }
  return sh;
}

function ensureFolderStructure_() {
  const root = DriveApp.getFolderById(APP.ROOT_FOLDER_ID);
  const docs = getOrCreateFolder_(root, 'Documentos');
  const system = getOrCreateFolder_(root, 'Sistema');
  return {
    DOCS: docs.getId(), POP: getOrCreateFolder_(docs, 'POP').getId(), IT: getOrCreateFolder_(docs, 'IT').getId(), FOR: getOrCreateFolder_(docs, 'FOR').getId(), POL: getOrCreateFolder_(docs, 'POL').getId(),
    SOURCES: getOrCreateFolder_(system, 'Fontes').getId(), IMAGES: getOrCreateFolder_(system, 'Imagens').getId(), TEMP: getOrCreateFolder_(system, 'Temporários').getId()
  };
}

function getOrCreateFolder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function getFolderConfig_(key) { const value = getConfig_('FOLDER_' + key); if (!value) throw new Error('Pasta ' + key + ' não configurada. Execute configurarPlataforma().'); return DriveApp.getFolderById(value); }

function seedDefaults_() {
  if (!readRows_(SHEETS.USERS).length) appendRow_(SHEETS.USERS, {Id:'usr_admin',Usuario:'admin',Senha:'admin123',Nome:'Administrador',Papeis:'Manager',Setores:'*',Ativo:true,TrocarSenha:true,CriadoEm:now_(),AtualizadoEm:now_()});
  if (!readRows_(SHEETS.SECTORS).length) appendRow_(SHEETS.SECTORS, {Id:'set_qual',Nome:'Qualidade',Sigla:'QUAL',ResponsavelId:'usr_admin',ResponsavelNome:'Administrador',Ativo:true,CriadoEm:now_(),AtualizadoEm:now_(),SupervisorId:'usr_admin',SupervisorNome:'Administrador',AprovadorId:'usr_admin',AprovadorNome:'Administrador'});
}

function migrateSectorRoles_() {
  readRows_(SHEETS.SECTORS).forEach(function(sector) {
    const fallbackId = normalize_(sector.ResponsavelId) || normalize_(sector.SupervisorId) || 'usr_admin';
    const fallback = findById_(SHEETS.USERS, fallbackId) || findById_(SHEETS.USERS, 'usr_admin');
    if (!fallback) return;
    const fallbackName = String(fallback.Nome || fallback.Usuario);
    updateRow_(SHEETS.SECTORS, sector._row, {
      ResponsavelId: normalize_(sector.ResponsavelId) || fallback.Id,
      ResponsavelNome: normalize_(sector.ResponsavelNome) || fallbackName,
      SupervisorId: normalize_(sector.SupervisorId) || fallback.Id,
      SupervisorNome: normalize_(sector.SupervisorNome) || fallbackName,
      AprovadorId: normalize_(sector.AprovadorId) || fallback.Id,
      AprovadorNome: normalize_(sector.AprovadorNome) || fallbackName,
      AtualizadoEm: normalize_(sector.AtualizadoEm) || now_()
    });
  });
}

function migratePurchaseSectorCode_() {
  const sectors=readRows_(SHEETS.SECTORS).filter(function(sector){return normalizedName_(sector.Nome)==='compras';});
  if(!sectors.length)return;
  const sectorIds={};sectors.forEach(function(sector){sectorIds[String(sector.Id)]=true;if(String(sector.Sigla)!=='SUP')updateRow_(SHEETS.SECTORS,sector._row,{Sigla:'SUP',AtualizadoEm:now_()});});
  const docs=readRows_(SHEETS.DOCS),docCodes={};
  docs.filter(function(doc){return sectorIds[String(doc.SetorId)];}).forEach(function(doc){
    const oldCode=String(doc.Codigo||''),newCode=oldCode.replace(/^([A-Z]+)-COM-/,'$1-SUP-');docCodes[String(doc.Id)]=newCode||oldCode;
    if(newCode&&newCode!==oldCode){updateRow_(SHEETS.DOCS,doc._row,{Codigo:newCode,AtualizadoEm:now_()});renameDriveItem_(doc.PastaId,newCode);renameDocumentFile_(doc.FonteFileId,newCode,doc.Edicao,'.json');renameDocumentFile_(doc.PdfFileId,newCode,doc.Edicao,'.pdf');}
  });
  readRows_(SHEETS.EDITIONS).filter(function(row){return docCodes[String(row.DocumentoId)];}).forEach(function(row){const code=docCodes[String(row.DocumentoId)];if(String(row.Codigo)!==code)updateRow_(SHEETS.EDITIONS,row._row,{Codigo:code});renameDocumentFile_(row.FonteFileId,code,row.Edicao,'.json');renameDocumentFile_(row.PdfFileId,code,row.Edicao,'.pdf');});
  readRows_(SHEETS.TRAININGS).filter(function(row){return docCodes[String(row.DocumentoId)];}).forEach(function(row){const code=docCodes[String(row.DocumentoId)];if(String(row.Codigo)!==code)updateRow_(SHEETS.TRAININGS,row._row,{Codigo:code});});
}
function normalizedName_(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();}
function renameDriveItem_(id,name){if(!normalize_(id)||!normalize_(name))return;try{DriveApp.getFolderById(String(id)).setName(String(name));}catch(e){console.warn('Não foi possível renomear a pasta '+id+': '+e.message);}}
function renameDocumentFile_(id,code,edition,extension){if(!normalize_(id)||!normalize_(code))return;try{DriveApp.getFileById(String(id)).setName(String(code)+' - '+String(edition||'Ed. 01')+String(extension||''));}catch(e){console.warn('Não foi possível renomear o arquivo '+id+': '+e.message);}}

function detachAutomaticCollaborators_() {
  readRows_(SHEETS.PEOPLE).filter(function(person) { return !!normalize_(person.UserId); }).forEach(function(person) {
    updateRow_(SHEETS.PEOPLE, person._row, {Ativo:false,AtualizadoEm:now_()});
  });
}

function migrateDocumentStatuses_() {
  readRows_(SHEETS.DOCS).forEach(function(doc) {
    if (String(doc.Status) === 'Rascunho') updateRow_(SHEETS.DOCS, doc._row, {Status:'Em criação', AtualizadoEm:now_()});
    if (String(doc.Status) === 'Em revisão') updateRow_(SHEETS.DOCS, doc._row, {Status:'Aguardando aprovação', AtualizadoEm:now_()});
  });
}

function ss_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || APP.SPREADSHEET_ID); }
function sheet_(name) { const sh = ss_().getSheetByName(name); if (!sh) throw new Error('Aba "' + name + '" não encontrada. Execute configurarPlataforma().'); return sh; }
function readRows_(name) {
  const sh = sheet_(name), values = sh.getDataRange().getValues(); if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map(function(row, i){ const obj={_row:i+2}; headers.forEach(function(h,j){obj[h]=row[j];}); return obj; }).filter(function(obj){return headers.some(function(h){return normalize_(obj[h]);});});
}
function readTailRows_(name,limit){const sh=sheet_(name),last=sh.getLastRow();if(last<2)return [];const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String),count=Math.min(Math.max(0,Number(limit)||0),last-1),start=last-count+1,values=count?sh.getRange(start,1,count,headers.length).getValues():[];return values.map(function(row,i){const obj={_row:start+i};headers.forEach(function(h,j){obj[h]=row[j];});return obj;}).filter(function(obj){return headers.some(function(h){return normalize_(obj[h]);});});}
function appendRow_(name, obj) { if(name===SHEETS.DOCS&&String(obj.Status)==='Rascunho')obj.Status='Em criação'; const headers=HEADERS[name], sh=sheet_(name); sh.appendRow(headers.map(function(h){return obj[h] == null ? '' : obj[h];})); return obj; }
function updateRow_(name, rowNumber, changes) { const sh=sheet_(name), headers=HEADERS[name], row=sh.getRange(rowNumber,1,1,headers.length).getValues()[0]; headers.forEach(function(h,i){if(Object.prototype.hasOwnProperty.call(changes,h)) row[i]=changes[h];}); sh.getRange(rowNumber,1,1,headers.length).setValues([row]); }
function findById_(name, id) { return readRows_(name).find(function(row){return String(row.Id)===String(id);}) || null; }
function upsertConfig_(key,value,description) { const found=readRows_(SHEETS.CONFIG).find(function(r){return String(r.Chave)===String(key);}); if(found) updateRow_(SHEETS.CONFIG,found._row,{Valor:value,Descrição:description||found.Descrição,AtualizadoEm:now_()}); else appendRow_(SHEETS.CONFIG,{Chave:key,Valor:value,Descrição:description||'',AtualizadoEm:now_()}); }
function getConfig_(key) { const row=readRows_(SHEETS.CONFIG).find(function(r){return String(r.Chave)===String(key);}); return row ? normalize_(row.Valor) : ''; }
function audit_(session, entity, entityId, action, details) { appendRow_(SHEETS.AUDIT,{Id:uid_('aud'),Entidade:entity,EntidadeId:entityId,Ação:action,Acao:action,UsuarioId:session.id,UsuarioNome:session.name,Detalhes:typeof details==='string'?details:JSON.stringify(details||{}),Data:now_()}); }

function safeRows_(name) { try { return readRows_(name); } catch(e) { return []; } }
