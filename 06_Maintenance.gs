const CLEANUP = Object.freeze({
  PENDING_PROPERTY: 'PENDING_PORTAL_CLEANUP',
  PRIMARY_MANAGER_PROPERTY: 'CLEANUP_PRIMARY_MANAGER',
  EXPIRES_MINUTES: 30,
  DATA_SHEETS: [SHEETS.SECTORS,SHEETS.PEOPLE,SHEETS.DOCS,SHEETS.FLOWS,SHEETS.APPROVALS,SHEETS.EDITIONS,SHEETS.TRAININGS,SHEETS.PARTICIPANTS,SHEETS.AUDIT],
  DRIVE_KEYS: ['POP','IT','FOR','POL','SOURCES','IMAGES','TEMP']
});

/**
 * Etapa 1: gera o inventário e libera a confirmação por 30 minutos.
 * Não exclui nem altera registros operacionais.
 */
function prepararLimpezaCompletaPortal(){return publicCall_(function(){
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const manager=cleanupPrimaryManager_(),counts={};
    [SHEETS.USERS].concat(CLEANUP.DATA_SHEETS).forEach(function(name){counts[name]=readRows_(name).length;});
    const request={id:uid_('cleanup'),managerId:String(manager.Id),managerUser:String(manager.Usuario),createdAt:now_(),expiresAt:Date.now()+CLEANUP.EXPIRES_MINUTES*60*1000,counts:counts};
    PropertiesService.getScriptProperties().setProperty(CLEANUP.PENDING_PROPERTY,JSON.stringify(request));
    return {prepared:true,executed:false,requestId:request.id,expiresInMinutes:CLEANUP.EXPIRES_MINUTES,primaryManager:request.managerUser,records:counts,nextStep:'Execute confirmarLimpezaCompletaPortal() dentro de '+CLEANUP.EXPIRES_MINUTES+' minutos. Para desistir, execute cancelarLimpezaCompletaPortal().'};
  }finally{lock.releaseLock();}
});}

/**
 * Etapa 2: cria backup e executa a limpeza preparada.
 * Só funciona após prepararLimpezaCompletaPortal().
 */
function confirmarLimpezaCompletaPortal(){return publicCall_(function(){
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const props=PropertiesService.getScriptProperties(),raw=props.getProperty(CLEANUP.PENDING_PROPERTY);
    if(!raw)throw new Error('Nenhuma limpeza está preparada. Execute prepararLimpezaCompletaPortal() primeiro.');
    const request=JSON.parse(raw);if(!request.expiresAt||Date.now()>Number(request.expiresAt)){props.deleteProperty(CLEANUP.PENDING_PROPERTY);throw new Error('A autorização de limpeza expirou. Prepare novamente.');}
    const manager=findById_(SHEETS.USERS,request.managerId);
    if(!manager||!bool_(manager.Ativo)||split_(manager.Papeis).indexOf('Manager')<0||!normalize_(manager.Senha))throw new Error('O Manager principal não está ativo, não possui senha ou deixou de ser Manager. Limpeza cancelada.');
    const backup=cleanupBackup_(request);
    CLEANUP.DRIVE_KEYS.forEach(function(key){trashFolderContents_(getFolderConfig_(key));});
    const allUsers=readRows_(SHEETS.USERS);allUsers.forEach(function(user){CacheService.getScriptCache().remove('login:'+normalize_(user.Usuario).toLowerCase());});
    CLEANUP.DATA_SHEETS.forEach(clearSheetData_);
    clearSheetData_(SHEETS.USERS);
    const preserved=cleanRow_(manager);preserved.Papeis='Manager';preserved.Setores='*';preserved.Ativo=true;preserved.TrocarSenha=false;preserved.AtualizadoEm=now_();appendRow_(SHEETS.USERS,preserved);
    Object.keys(props.getProperties()).filter(function(key){return key.indexOf('SESSION_')===0;}).forEach(function(key){props.deleteProperty(key);});
    props.deleteProperty(CLEANUP.PENDING_PROPERTY);SpreadsheetApp.flush();
    return {prepared:true,executed:true,primaryManager:String(preserved.Usuario),backupFolderId:backup.id,backupFolderUrl:backup.url,completedAt:now_(),message:'Limpeza concluída. A estrutura foi preservada e somente o Manager principal permaneceu cadastrado.'};
  }finally{lock.releaseLock();}
});}

function cancelarLimpezaCompletaPortal(){return publicCall_(function(){PropertiesService.getScriptProperties().deleteProperty(CLEANUP.PENDING_PROPERTY);return {cancelled:true};});}

function definirManagerPrincipalLimpeza(usuarioOuId){return publicCall_(function(){
  const value=normalize_(usuarioOuId);if(!value)throw new Error('Informe o usuário ou ID do Manager principal.');
  const user=readRows_(SHEETS.USERS).find(function(row){return String(row.Id)===value||normalize_(row.Usuario).toLowerCase()===value.toLowerCase();});
  if(!user||!bool_(user.Ativo)||split_(user.Papeis).indexOf('Manager')<0)throw new Error('Manager principal ativo não encontrado.');
  PropertiesService.getScriptProperties().setProperty(CLEANUP.PRIMARY_MANAGER_PROPERTY,String(user.Id));return {primaryManager:String(user.Usuario),id:String(user.Id)};
});}

function cleanupPrimaryManager_(){
  const users=readRows_(SHEETS.USERS),configured=normalize_(PropertiesService.getScriptProperties().getProperty(CLEANUP.PRIMARY_MANAGER_PROPERTY)),active=users.filter(function(user){return bool_(user.Ativo)&&split_(user.Papeis).indexOf('Manager')>=0&&normalize_(user.Senha);});
  if(configured){const selected=active.find(function(user){return String(user.Id)===configured||normalize_(user.Usuario).toLowerCase()===configured.toLowerCase();});if(!selected)throw new Error('O Manager configurado em '+CLEANUP.PRIMARY_MANAGER_PROPERTY+' não foi encontrado ou está sem senha.');return selected;}
  if(active.length===1)return active[0];
  if(!active.length)throw new Error('Nenhum Manager ativo com senha foi encontrado.');
  throw new Error('Existem vários Managers ativos: '+active.map(function(user){return user.Usuario;}).join(', ')+'. Defina '+CLEANUP.PRIMARY_MANAGER_PROPERTY+' nas Propriedades do script ou use definirManagerPrincipalLimpeza(usuario).');
}

function cleanupBackup_(request){
  const root=DriveApp.getFolderById(APP.ROOT_FOLDER_ID),system=getOrCreateFolder_(root,'Sistema'),backups=getOrCreateFolder_(system,'Backups'),stamp=Utilities.formatDate(new Date(),APP.TIMEZONE,'yyyy-MM-dd_HH-mm-ss'),snapshot=backups.createFolder('Antes da limpeza - '+stamp);
  DriveApp.getFileById(APP.SPREADSHEET_ID).makeCopy('Planilha Gestão de Documentos - '+stamp,snapshot);
  const docsCopy=snapshot.createFolder('Documentos');['POP','IT','FOR','POL'].forEach(function(key){const target=docsCopy.createFolder(key);copyFolderContents_(getFolderConfig_(key),target);});
  const systemCopy=snapshot.createFolder('Sistema');['SOURCES','IMAGES'].forEach(function(key){const target=systemCopy.createFolder(key);copyFolderContents_(getFolderConfig_(key),target);});
  snapshot.createFile('manifesto-limpeza.json',JSON.stringify({application:APP.NAME,version:APP.VERSION,request:request,createdAt:now_()},null,2),MimeType.PLAIN_TEXT);
  return {id:snapshot.getId(),url:snapshot.getUrl()};
}

function copyFolderContents_(source,target){
  const files=source.getFiles();while(files.hasNext()){const file=files.next();file.makeCopy(file.getName(),target);}
  const folders=source.getFolders();while(folders.hasNext()){const folder=folders.next(),child=target.createFolder(folder.getName());copyFolderContents_(folder,child);}
}

function trashFolderContents_(folder){
  const files=folder.getFiles();while(files.hasNext())files.next().setTrashed(true);
  const folders=folder.getFolders();while(folders.hasNext())folders.next().setTrashed(true);
}

function clearSheetData_(name){const sh=sheet_(name),last=sh.getLastRow();if(last>1)sh.getRange(2,1,last-1,sh.getLastColumn()).clearContent();}
