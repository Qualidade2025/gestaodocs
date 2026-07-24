function login(usuario, senha) { return publicCall_(function(){
  usuario=normalize_(usuario).toLowerCase(); senha=String(senha==null?'':senha); if(!usuario||!senha) throw new Error('Informe usuário e senha.');
  const cache=CacheService.getScriptCache(), attemptKey='login:'+usuario, attempt=JSON.parse(cache.get(attemptKey)||'{"count":0}');
  if(attempt.lockedUntil && Date.now()<attempt.lockedUntil) throw new Error('Acesso temporariamente bloqueado. Tente novamente em alguns minutos.');
  const user=readRows_(SHEETS.USERS).find(function(u){return normalize_(u.Usuario).toLowerCase()===usuario && bool_(u.Ativo);});
  if(!user || String(user.Senha)!==senha){ attempt.count=(attempt.count||0)+1; if(attempt.count>=APP.MAX_LOGIN_ATTEMPTS) attempt.lockedUntil=Date.now()+APP.LOCKOUT_SECONDS*1000; cache.put(attemptKey,JSON.stringify(attempt),APP.LOCKOUT_SECONDS); throw new Error('Usuário ou senha inválidos.'); }
  cache.remove(attemptKey); const token=Utilities.getUuid(); const session={id:String(user.Id),user:String(user.Usuario),name:String(user.Nome),roles:split_(user.Papeis),sectors:split_(user.Setores),mustChangePassword:bool_(user.TrocarSenha),expiresAt:Date.now()+APP.SESSION_SECONDS*1000};
  PropertiesService.getScriptProperties().setProperty('SESSION_'+token,JSON.stringify(session)); return {token:token,profile:session};
}); }
function getProfile(token){return publicCall_(function(){return session_(token);});}
function logout(token){return publicCall_(function(){PropertiesService.getScriptProperties().deleteProperty('SESSION_'+String(token||''));return true;});}
function session_(token){const key='SESSION_'+String(token||''),props=PropertiesService.getScriptProperties(),raw=props.getProperty(key);if(!raw)throw new Error('Sessão expirada. Entre novamente.');const session=JSON.parse(raw);if(!session.expiresAt||Date.now()>session.expiresAt){props.deleteProperty(key);throw new Error('Sessão expirada. Entre novamente.');}const user=findById_(SHEETS.USERS,session.id);if(!user||!bool_(user.Ativo)){props.deleteProperty(key);throw new Error('Usuário inativo. Entre novamente.');}session.name=String(user.Nome||user.Usuario);session.roles=split_(user.Papeis);session.sectors=split_(user.Setores);props.setProperty(key,JSON.stringify(session));return session;}
function requireRole_(session, roles){if(!roles.some(function(r){return hasRole_(session,r);}))throw new Error('Você não tem permissão para esta operação.');}
function alterarMinhaSenha(token, atual, novaSenha){return publicCall_(function(){const s=session_(token);if(String(novaSenha||'').length<6)throw new Error('A nova senha deve ter ao menos 6 caracteres.');const u=findById_(SHEETS.USERS,s.id);if(!u||String(u.Senha)!==String(atual||''))throw new Error('Senha atual incorreta.');updateRow_(SHEETS.USERS,u._row,{Senha:String(novaSenha),TrocarSenha:false,AtualizadoEm:now_()});audit_(s,'Usuário',s.id,'ALTEROU_SENHA',{});return true;});}

function getBootstrap(token){return publicCall_(function(){const s=session_(token);return {profile:s,sectors:allActiveSectors_(),userSectors:visibleSectors_(s),users:visibleUsers_(s),docSections:DOC_SECTIONS,version:APP.VERSION};});}
function allActiveSectors_(){return readRows_(SHEETS.SECTORS).filter(function(x){return bool_(x.Ativo);}).sort(function(a,b){return String(a.Nome||'').localeCompare(String(b.Nome||''),'pt-BR');}).map(cleanRow_);}
function visibleSectors_(s){return readRows_(SHEETS.SECTORS).filter(function(x){return bool_(x.Ativo)&&canSector_(s,x.Id);}).map(cleanRow_);}
function visibleUsers_(s){return readRows_(SHEETS.USERS).filter(function(x){return bool_(x.Ativo)&&(isManager_(s)||split_(x.Setores).some(function(id){return canSector_(s,id);})||String(x.Id)===s.id);}).map(sanitizeUser_);}
function cleanRow_(row){const out={};Object.keys(row).forEach(function(k){if(k!=='_row')out[k]=row[k] instanceof Date?row[k].toISOString():row[k];});return out;}
function sanitizeUser_(u){const out=cleanRow_(u);delete out.Senha;return out;}

function collaboratorSectorIds_(s){if(isManager_(s))return readRows_(SHEETS.SECTORS).map(function(sector){return String(sector.Id);});return readRows_(SHEETS.SECTORS).filter(function(sector){return String(sector.ResponsavelId)===String(s.id)||String(sector.SupervisorId)===String(s.id);}).map(function(sector){return String(sector.Id);});}
function listarAdministracao(token){return publicCall_(function(){const s=session_(token),manager=isManager_(s),visitor=isVisitor_(s),allowed=collaboratorSectorIds_(s),allUsers=readRows_(SHEETS.USERS);if(visitor)return {restricted:'visitor',sectors:[],users:allUsers.map(sanitizeUser_),people:[]};if(!manager&&!allowed.length)throw new Error('Você não possui setores autorizados para gerenciar colaboradores.');const sectors=readRows_(SHEETS.SECTORS),visibleSectors=manager?sectors:sectors.filter(function(sector){return allowed.indexOf(String(sector.Id))>=0;}),people=readRows_(SHEETS.PEOPLE).filter(function(person){return !normalize_(person.UserId)&&split_(person.SetorId).some(function(id){return allowed.indexOf(String(id))>=0;});}).map(function(person){if(manager)return cleanRow_(person);const out=cleanRow_(person),ids=split_(person.SetorId).filter(function(id){return allowed.indexOf(String(id))>=0;}),names=visibleSectors.filter(function(sector){return ids.indexOf(String(sector.Id))>=0;}).map(function(sector){return String(sector.Nome);});out.SetorId=ids.join(';');out.Setor=names.join(';');return out;});return {restricted:manager?false:'people',sectors:visibleSectors.map(cleanRow_),users:manager?allUsers.map(function(user){const out=sanitizeUser_(user);out.Senha=String(user.Senha||'');out.SenhaConfigurada=!!normalize_(user.Senha);return out;}):[],people:people};});}
function obterUsuarioAdministracao(token,userId){return publicCall_(function(){const s=session_(token);requireRole_(s,['Manager']);const user=findById_(SHEETS.USERS,userId);if(!user)throw new Error('Usuario nao encontrado.');return {Id:String(user.Id),Usuario:String(user.Usuario),Senha:String(user.Senha),Papeis:String(user.Papeis||''),Setores:String(user.Setores||''),Ativo:bool_(user.Ativo)};});}
function salvarSetor(token,p){return publicCall_(function(){
  const s=session_(token);requireRole_(s,['Manager']);p=p||{};
  const nome=normalize_(p.Nome);if(!nome)throw new Error('Informe o nome do setor.');
  const sigla=sectorCode_(nome);
  const duplicate=readRows_(SHEETS.SECTORS).find(function(x){return normalize_(x.Sigla).toUpperCase()===sigla&&String(x.Id)!==String(p.Id||'');});
  if(duplicate)throw new Error('Já existe um setor cuja sigla automática é '+sigla+'.');
  validateSectorUserSpec_(p.Responsavel,'responsável');
  validateSectorUserSpec_(p.Supervisor,'supervisor');
  validateSectorUserSpec_(p.Aprovador,'aprovador');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  let snapshot=null,backupFolder=null;
  try{
    const current=p.Id?findById_(SHEETS.SECTORS,p.Id):null;
    if(p.Id&&!current)throw new Error('O setor selecionado não foi encontrado.');
    const sectorId=current?current.Id:uid_('set');
    snapshot=sectorAssignmentSnapshot_(current);
    if(current)backupFolder=backupSectorAssignment_(current,snapshot,s);
    const owner=resolveSectorUser_(p.Responsavel,'Responsável de setor',sectorId);
    const supervisor=resolveSectorUser_(p.Supervisor,'Supervisor',sectorId);
    const approver=resolveSectorUser_(p.Aprovador,'Aprovador',sectorId);
    const obj={Id:sectorId,Nome:nome,Sigla:sigla,ResponsavelId:owner.Id,ResponsavelNome:owner.Nome,Ativo:p.Ativo!==false,CriadoEm:current?current.CriadoEm:now_(),AtualizadoEm:now_(),SupervisorId:supervisor.Id,SupervisorNome:supervisor.Nome,AprovadorId:approver.Id,AprovadorNome:approver.Nome};
    if(current)updateRow_(SHEETS.SECTORS,current._row,obj);else appendRow_(SHEETS.SECTORS,obj);
    const transfer=current?reconcileSectorAssignments_(current,obj):emptySectorTransferSummary_();
    syncSectorUsers_();
    const details={setor:cleanRow_(obj),alteracoes:transfer,backupFolderId:backupFolder?backupFolder.getId():''};
    audit_(s,'Setor',obj.Id,current?'ALTEROU':'CRIOU',details);
    SpreadsheetApp.flush();
    if(backupFolder)backupFolder.createFile('resultado_transferencia.json',JSON.stringify({ok:true,setor:cleanRow_(obj),alteracoes:transfer,data:now_()},null,2),MimeType.PLAIN_TEXT);
    return cleanRow_(obj);
  }catch(error){
    if(snapshot){
      try{restoreSectorAssignmentSnapshot_(snapshot);SpreadsheetApp.flush();}
      catch(rollbackError){throw new Error('Falha ao salvar o setor e também ao restaurar os dados. Backup: '+(backupFolder?backupFolder.getUrl():'não criado')+'. Erro original: '+error.message+'. Erro da restauração: '+rollbackError.message);}
    }
    if(backupFolder){
      try{backupFolder.createFile('resultado_transferencia.json',JSON.stringify({ok:false,revertido:true,erro:String(error&&error.message||error),data:now_()},null,2),MimeType.PLAIN_TEXT);}catch(ignore){}
    }
    throw new Error('A alteração do setor não foi concluída. Todas as mudanças foram revertidas. '+String(error&&error.message||error));
  }finally{lock.releaseLock();}
});}
function emptySectorTransferSummary_(){return {responsavelAlterado:false,supervisorAlterado:false,aprovadorAlterado:false,documentosAtualizados:0,revisoesAbertasAtualizadas:0,fluxosCancelados:0,pendenciasTransferidas:0};}
function sectorRoleChanged_(before,after,idField,nameField){return String(before[idField]||'')!==String(after[idField]||'')||String(before[nameField]||'')!==String(after[nameField]||'');}
function reconcileSectorAssignments_(before,after){
  const summary=emptySectorTransferSummary_();
  summary.responsavelAlterado=sectorRoleChanged_(before,after,'ResponsavelId','ResponsavelNome');
  summary.supervisorAlterado=sectorRoleChanged_(before,after,'SupervisorId','SupervisorNome');
  summary.aprovadorAlterado=sectorRoleChanged_(before,after,'AprovadorId','AprovadorNome');
  if(!summary.responsavelAlterado&&!summary.supervisorAlterado&&!summary.aprovadorAlterado)return summary;
  const docs=readRows_(SHEETS.DOCS).filter(function(doc){return String(doc.SetorId)===String(after.Id);});
  const flows=readRows_(SHEETS.FLOWS),touched={};
  docs.forEach(function(doc){
    if(summary.responsavelAlterado){
      updateRow_(SHEETS.DOCS,doc._row,{ResponsavelId:after.ResponsavelId,ResponsavelNome:after.ResponsavelNome,AtualizadoEm:now_()});
      touched[String(doc.Id)]=true;
    }
    const open=['Em criação','Em revisão','Aguardando aprovação'].indexOf(String(doc.Status))>=0;
    if(open&&String(doc.Tipo)!=='FOR'&&(summary.responsavelAlterado||summary.aprovadorAlterado)&&normalize_(doc.FonteFileId)){
      const file=DriveApp.getFileById(String(doc.FonteFileId)),source=JSON.parse(file.getBlob().getDataAsString('UTF-8')),revisions=source.revisions||[];
      const revision=revisions.find(function(row){return String(row.edicao)===String(doc.Edicao);});
      if(revision){
        if(summary.responsavelAlterado)revision.responsavel=String(after.ResponsavelNome||'');
        if(summary.aprovadorAlterado)revision.aprovador=String(after.AprovadorNome||'');
        source.revisions=revisions;source.updatedAt=now_();file.setContent(JSON.stringify(source));
        summary.revisoesAbertasAtualizadas++;
      }
    }
    if(summary.aprovadorAlterado&&String(doc.Status)==='Aguardando aprovação'){
      const active=flows.filter(function(flow){return String(flow.DocumentoId)===String(doc.Id)&&String(flow.Edicao)===String(doc.Edicao)&&['Pendente','Aguardando','Proposto'].indexOf(String(flow.Status))>=0;});
      const lifecycle=active.map(function(flow){return String(flow.Decisao||'');}).find(function(value){return value==='Obsolescência'||value==='Reativação';})||'';
      active.forEach(function(flow){updateRow_(SHEETS.FLOWS,flow._row,{Status:'Cancelado'});summary.fluxosCancelados++;});
      appendRow_(SHEETS.FLOWS,{Id:uid_('flx'),DocumentoId:doc.Id,Edicao:doc.Edicao,Ordem:1,UsuarioId:after.AprovadorId,UsuarioNome:after.AprovadorNome,Status:'Pendente',Decisao:lifecycle,Comentario:'',Data:''});
      updateRow_(SHEETS.DOCS,doc._row,{AtualizadoEm:now_()});
      touched[String(doc.Id)]=true;summary.pendenciasTransferidas++;
    }
  });
  summary.documentosAtualizados=Object.keys(touched).length;
  return summary;
}
function sheetDataSnapshot_(name){return sheet_(name).getDataRange().getValues();}
function restoreSheetDataSnapshot_(name,values){
  const sh=sheet_(name),columns=values.length?values[0].length:HEADERS[name].length,last=Math.max(sh.getLastRow(),values.length);
  if(last>1)sh.getRange(2,1,last-1,columns).clearContent();
  if(values.length>1)sh.getRange(2,1,values.length-1,columns).setValues(values.slice(1));
}
function sectorAssignmentSnapshot_(sector){
  const documents=sector?readRows_(SHEETS.DOCS).filter(function(doc){return String(doc.SetorId)===String(sector.Id);}):[];
  const sources=[];
  documents.filter(function(doc){return ['Em criação','Em revisão','Aguardando aprovação'].indexOf(String(doc.Status))>=0&&String(doc.Tipo)!=='FOR'&&normalize_(doc.FonteFileId);}).forEach(function(doc){
    const file=DriveApp.getFileById(String(doc.FonteFileId));
    sources.push({id:String(doc.FonteFileId),name:file.getName(),content:file.getBlob().getDataAsString('UTF-8')});
  });
  const sheets={};
  [SHEETS.SECTORS,SHEETS.USERS,SHEETS.DOCS,SHEETS.FLOWS,SHEETS.AUDIT].forEach(function(name){sheets[name]=sheetDataSnapshot_(name);});
  return {sector:sector?cleanRow_(sector):null,documents:documents.map(cleanRow_),sources:sources,sheets:sheets};
}
function restoreSectorAssignmentSnapshot_(snapshot){
  Object.keys(snapshot.sheets).forEach(function(name){restoreSheetDataSnapshot_(name,snapshot.sheets[name]);});
  (snapshot.sources||[]).forEach(function(source){DriveApp.getFileById(source.id).setContent(source.content);});
}
function backupSectorAssignment_(sector,snapshot,session){
  const stamp=Utilities.formatDate(new Date(),APP.TIMEZONE,'yyyyMMdd-HHmmss');
  const root=DriveApp.getFolderById(APP.ROOT_FOLDER_ID),folder=root.createFolder('_Backup_Alteracao_Responsaveis_Setor_'+String(sector.Sigla||sector.Nome)+'_'+stamp);
  DriveApp.getFileById(APP.SPREADSHEET_ID).makeCopy('Backup antes da alteração do setor '+String(sector.Nome)+' '+stamp,folder);
  (snapshot.sources||[]).forEach(function(source){DriveApp.getFileById(source.id).makeCopy('ANTES - '+source.name,folder);});
  const pending=readRows_(SHEETS.FLOWS).filter(function(flow){return snapshot.documents.some(function(doc){return String(doc.Id)===String(flow.DocumentoId);})&&['Pendente','Aguardando','Proposto'].indexOf(String(flow.Status))>=0;});
  folder.createFile('manifesto_antes.json',JSON.stringify({setor:snapshot.sector,documentos:snapshot.documents.map(function(doc){return {Id:doc.Id,Codigo:doc.Codigo,Edicao:doc.Edicao,Status:doc.Status,ResponsavelId:doc.ResponsavelId,ResponsavelNome:doc.ResponsavelNome};}),fluxosPendentes:pending.map(cleanRow_),executadoPor:{id:session.id,nome:session.name},data:now_()},null,2),MimeType.PLAIN_TEXT);
  return folder;
}
function sectorCode_(name){const normalized=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');if(normalized.trim().toLowerCase()==='compras')return 'SUP';return normalized.replace(/[^A-Za-z0-9]/g,'').slice(0,3).toUpperCase();}
function validateSectorUserSpec_(spec,label){spec=spec||{};if(normalize_(spec.Id)){if(!findById_(SHEETS.USERS,spec.Id))throw new Error('O '+label+' selecionado não foi encontrado.');return;}if(!normalize_(spec.Usuario))throw new Error('Selecione ou cadastre o '+label+'.');}
function resolveSectorUser_(spec,role,sectorId){spec=spec||{};let user=normalize_(spec.Id)?findById_(SHEETS.USERS,spec.Id):null;if(!user){const usuario=normalize_(spec.Usuario);if(!usuario)throw new Error('Selecione ou cadastre o '+role.toLowerCase()+'.');user=readRows_(SHEETS.USERS).find(function(x){return normalize_(x.Usuario).toLowerCase()===usuario.toLowerCase();});if(!user){user={Id:uid_('usr'),Usuario:usuario,Senha:'',Nome:usuario,Papeis:role,Setores:sectorId,Ativo:true,TrocarSenha:true,CriadoEm:now_(),AtualizadoEm:now_()};appendRow_(SHEETS.USERS,user);}}if(split_(user.Papeis).indexOf('Visitante')>=0)throw new Error('Um Visitante não pode ser definido como '+role.toLowerCase()+'. Remova primeiro o tipo Visitante na aba Usuários.');if(!bool_(user.Ativo))updateRow_(SHEETS.USERS,user._row,{Ativo:true,AtualizadoEm:now_()});return {Id:String(user.Id),Nome:String(user.Nome||user.Usuario)};}
function syncSectorUsers_(){const sectors=readRows_(SHEETS.SECTORS),assignments={};sectors.forEach(function(sec){[['ResponsavelId','Responsável de setor'],['SupervisorId','Supervisor'],['AprovadorId','Aprovador']].forEach(function(pair){const id=normalize_(sec[pair[0]]);if(!id)return;if(!assignments[id])assignments[id]={roles:[],sectors:[]};if(assignments[id].roles.indexOf(pair[1])<0)assignments[id].roles.push(pair[1]);if(assignments[id].sectors.indexOf(String(sec.Id))<0)assignments[id].sectors.push(String(sec.Id));});});readRows_(SHEETS.USERS).forEach(function(user){const base=split_(user.Papeis).filter(function(role){return role==='Manager'||role==='Visitante';}),assigned=assignments[String(user.Id)]||{roles:[],sectors:[]},roles=base.concat(assigned.roles.filter(function(role){return base.indexOf(role)<0;})),global=base.length>0;updateRow_(SHEETS.USERS,user._row,{Papeis:roles.join(';'),Setores:global?'*':assigned.sectors.join(';'),Ativo:roles.length?bool_(user.Ativo):false,AtualizadoEm:now_()});});}
function salvarUsuario(token,p){return publicCall_(function(){const s=session_(token);requireRole_(s,['Manager']);p=p||{};const current=p.Id?findById_(SHEETS.USERS,p.Id):null;if(current){if(!normalize_(p.Senha))throw new Error('Informe a senha.');const managed=split_(current.Papeis).filter(function(r){return r!=='Manager'&&r!=='Visitante';}),requested=(Array.isArray(p.Papeis)?p.Papeis:split_(p.Papeis)).filter(function(r){return r==='Manager'||r==='Visitante';}),active=p.Ativo!==false;if(requested.indexOf('Visitante')>=0&&(requested.indexOf('Manager')>=0||managed.length))throw new Error('Visitante não pode ser combinado com Manager, Responsável, Supervisor ou Aprovador.');const roles=requested.concat(managed);if(!roles.length)throw new Error('Este usuário precisa permanecer vinculado a ao menos um tipo ou setor.');if(split_(current.Papeis).indexOf('Manager')>=0&&(requested.indexOf('Manager')<0||!active)){const otherManager=readRows_(SHEETS.USERS).some(function(u){return String(u.Id)!==String(current.Id)&&bool_(u.Ativo)&&split_(u.Papeis).indexOf('Manager')>=0;});if(!otherManager)throw new Error('Não é possível remover ou inativar o último Manager ativo.');}updateRow_(SHEETS.USERS,current._row,{Senha:normalize_(p.Senha),Papeis:roles.join(';'),Ativo:active,TrocarSenha:true,AtualizadoEm:now_()});syncSectorUsers_();audit_(s,'Usuário',current.Id,'ALTEROU_ACESSO',{Papeis:roles,Ativo:active});return sanitizeUser_(findById_(SHEETS.USERS,current.Id));}const usuario=normalize_(p.Usuario);if(!usuario)throw new Error('Informe o usuário.');const duplicate=readRows_(SHEETS.USERS).find(function(x){return normalize_(x.Usuario).toLowerCase()===usuario.toLowerCase();});if(duplicate)throw new Error('Usuário já cadastrado.');if(!normalize_(p.Senha))throw new Error('Informe a senha inicial.');const requested=(Array.isArray(p.Papeis)?p.Papeis:split_(p.Papeis)).filter(function(r){return r==='Manager'||r==='Visitante';});if(requested.length!==1)throw new Error('Selecione apenas Manager ou Visitante.');const obj={Id:uid_('usr'),Usuario:usuario,Senha:normalize_(p.Senha),Nome:usuario,Papeis:requested.join(';'),Setores:'*',Ativo:p.Ativo!==false,TrocarSenha:true,CriadoEm:now_(),AtualizadoEm:now_()};appendRow_(SHEETS.USERS,obj);syncSectorUsers_();audit_(s,'Usuário',obj.Id,'CRIOU',{Usuario:obj.Usuario,Papeis:obj.Papeis});return sanitizeUser_(obj);});}
function salvarColaborador(token,p){return publicCall_(function(){const s=session_(token),manager=isManager_(s),allowed=collaboratorSectorIds_(s);if(!manager&&!allowed.length)throw new Error('Você não possui setores autorizados para gerenciar colaboradores.');p=p||{};const requested=(Array.isArray(p.Setores)?p.Setores:split_(p.SetorId)).map(String).filter(Boolean);if(!normalize_(p.Nome)||!requested.length)throw new Error('Informe nome e ao menos um setor.');requested.forEach(function(id){if(allowed.indexOf(String(id))<0)throw new Error('Setor não autorizado.');});const current=p.Id?findById_(SHEETS.PEOPLE,p.Id):null;if(current&&normalize_(current.UserId))throw new Error('Este registro pertence ao cadastro antigo de usuários. Crie o colaborador pela aba Colaboradores.');if(current&&!manager&&!split_(current.SetorId).some(function(id){return allowed.indexOf(String(id))>=0;}))throw new Error('Colaborador não autorizado.');const preserved=current&&!manager?split_(current.SetorId).filter(function(id){return allowed.indexOf(String(id))<0;}):[],sectorIds=requested.concat(preserved.filter(function(id){return requested.indexOf(String(id))<0;})),sectors=readRows_(SHEETS.SECTORS).filter(function(x){return sectorIds.indexOf(String(x.Id))!==-1;});if(sectors.length!==sectorIds.length)throw new Error('Um dos setores não foi encontrado.');const obj={Id:current?current.Id:uid_('col'),Nome:normalize_(p.Nome),Matricula:'',SetorId:sectorIds.join(';'),Setor:sectors.map(function(x){return x.Nome;}).join(';'),Ativo:p.Ativo!==false,CriadoEm:current?current.CriadoEm:now_(),AtualizadoEm:now_(),UserId:''};if(current)updateRow_(SHEETS.PEOPLE,current._row,obj);else appendRow_(SHEETS.PEOPLE,obj);syncCollaboratorTrainings_(obj);audit_(s,'Colaborador',obj.Id,current?'ALTEROU':'CRIOU',{Nome:obj.Nome,Setores:requested,Ativo:obj.Ativo});return cleanRow_(obj);});}
