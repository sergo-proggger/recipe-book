'use strict';
const $ = id => document.getElementById(id);
const modal = $('modal');
let db, recipes = [], onlyFavorites = false, toastTimer, attachmentURL;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('recipe-book-' + location.pathname.replace(/index\.html$/, '')) : null;
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text, fn, cls = 'secondary') {
  const b = el('button', text, cls);
  b.type = 'button';
  b.onclick = fn;
  return b;
}
function notify(message) {
  $('notice').textContent = message;
  $('notice').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('notice').hidden = true, 3600);
}
function openPanel(title) {
  if (attachmentURL) URL.revokeObjectURL(attachmentURL);
  attachmentURL = null;
  $('dt').textContent = title;
  $('panel').replaceChildren();
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
  return $('panel');
}
$('close').onclick = () => modal.close();
modal.addEventListener('close', () => { if (attachmentURL) URL.revokeObjectURL(attachmentURL); });
function openDB() {
  return new Promise((resolve, reject) => {
    const scope = location.pathname.replace(/index\.html$/, '');
    const req = indexedDB.open('kitchen-recipes:' + scope, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recipes', {keyPath:'id'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function reloadBook() {
  const saved = await new Promise((resolve, reject) => {
    const req = db.transaction('recipes').objectStore('recipes').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const merged = new Map(publishedRecipes.map(r => [r.id,r]));
  saved.forEach(r => merged.set(r.id,r));
  recipes = [...merged.values()].filter(r => !r.deleted).sort((a,b) => b.created - a.created);
  draw();
}
async function write(rows) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction('recipes','readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    rows.forEach(row => tx.objectStore('recipes').put(row));
  });
  await reloadBook();
  channel?.postMessage('updated');
}
function fail(panel, msg) {
  let p = panel.querySelector('.error');
  if (!p) { p = el('p','','error'); p.setAttribute('role','alert'); panel.append(p); }
  p.textContent = msg;
}
function actionError(panel) { fail(panel,'Не удалось сохранить книгу. Проверьте свободное место и повторите попытку.'); }
function draw() {
  const needle = $('search').value.toLocaleLowerCase('ru').trim();
  const shown = recipes.filter(r => (!onlyFavorites || r.favorite) && [r.title,r.body,r.category].join(' ').toLocaleLowerCase('ru').includes(needle));
  const list = $('list');
  list.replaceChildren();
  for (const r of shown) {
    const row = el('article',undefined,'row');
    const view = button('',() => detail(r),'entry');
    if (r.id === publishedRecipes[0]?.id || r.attachment?.type.startsWith('image/')) {
      const img = el('img',undefined,'thumb');
      img.src = r.attachment?.data || './blini.jpg'; img.alt = ''; img.loading = 'lazy'; view.append(img);
    } else { const tile = el('span', r.title[0].toUpperCase(),'thumb tile'); tile.ariaHidden='true'; view.append(tile); }
    const text = el('span');
    text.append(el('strong',r.title),el('small',[r.category,r.note].filter(Boolean).join(' · '))); view.append(text);
    const star = button(r.favorite ? '★' : '☆',async () => {
      star.disabled = true;
      try { await write([{...r,favorite:!r.favorite}]); } catch { star.disabled = false; notify('Не удалось сохранить избранное'); }
    },'star');
    star.setAttribute('aria-label',(r.favorite ? 'Убрать из избранного' : 'В избранное') + ' — ' + r.title);
    star.setAttribute('aria-pressed',Boolean(r.favorite));
    row.append(view,star); list.append(row);
  }
  if (!shown.length) list.append(el('p',needle ? 'По этому запросу ничего не найдено.' : onlyFavorites ? 'Нажмите звезду рядом с рецептом, чтобы добавить его в избранное.' : 'Добавьте первый рецепт или загрузите книгу из файла.','hint'));
  $('all').setAttribute('aria-pressed',!onlyFavorites); $('favorites').setAttribute('aria-pressed',onlyFavorites);
}
function detail(r) {
  const p = openPanel(r.title);
  p.append(el('p',[r.category,r.note].filter(Boolean).join(' · '),'hint'));
  if (r.attachment) {
    if (r.attachment.type.startsWith('image/')) {
      const img = el('img',undefined,'attachment'); img.src=r.attachment.data; img.alt=r.title; p.append(img);
    } else {
      const bytes = Uint8Array.from(atob(r.attachment.data.split(',')[1]), c => c.charCodeAt(0));
      attachmentURL = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
      const link = el('a','Открыть PDF','secondary'); link.href=attachmentURL; link.target='_blank'; link.rel='noopener'; p.append(link);
    }
  }
  const body = el('div',undefined,'bodytext');
  for (const para of r.body.split(/\n\s*\n/)) {
    const lines = para.split('\n');
    if (/^(ингредиенты|приготовление|шаги|состав):?$/i.test(lines[0].trim())) body.append(el('h3',lines.shift()));
    body.append(el('p',lines.join('\n')));
  }
  p.append(body);
  const actions=el('div',undefined,'actions');
  actions.append(button('Редактировать',()=>editor(r)),button('Удалить',()=>{
    const confirmPanel=openPanel('Удалить рецепт?');
    confirmPanel.append(el('p',r.title),button('Удалить из книги',async e=>{
      e.currentTarget.disabled=true;
      try { await write([{id:r.id,deleted:true}]); modal.close(); notify('Рецепт удалён'); }
      catch { actionError(confirmPanel); }
    }),button('Отмена',()=>detail(r),'quiet'));
  },'quiet')); p.append(actions);
}
function field(label,tag,value) {
  const wrap=el('label',label,'formlabel'), input=el(tag);
  input.value=value || ''; wrap.append(input); return [wrap,input];
}
function editor(r = {}, isNew = false) {
  const existing = Boolean(r.id) && !isNew;
  const p=openPanel(existing ? 'Редактировать рецепт' : 'Новый рецепт');
  const form=el('form');
  const [nameLabel,name]=field('Название блюда','input',r.title);
  const [bodyLabel,body]=field('Текст рецепта','textarea',r.body);
  name.placeholder='Например, бабушкины оладьи'; body.placeholder='Вставьте ингредиенты и способ приготовления';
  const [catLabel,cat]=field('Раздел','input',r.category || 'Мои записи');
  const [noteLabel,note]=field('Время и порции','input',r.note); note.placeholder='Например, 20 минут · 2 порции';
  if (!existing && !r.title) {
    p.append(button('Загрузить из файла',importPanel,'secondary upload'));
  }
  if (r.attachment) p.append(el('p','Прикреплён файл: ' + r.attachment.name,'hint'));
  form.append(nameLabel,bodyLabel,catLabel,noteLabel);
  const save=el('button','Сохранить рецепт','primary'); save.type='submit'; form.append(save); p.append(form);
  form.onsubmit=async ev=>{
    ev.preventDefault();
    let title=name.value.trim(), content=body.value.trim();
    if (!content && !r.attachment) { fail(p,'Добавьте текст рецепта.'); body.focus(); return; }
    if (!title) {
      const lines=content.split('\n');
      if (lines.length>1 && lines[0].length<=100) { title=lines.shift().trim(); content=lines.join('\n').trim(); }
      else { fail(p,'Введите название блюда.'); name.focus(); return; }
    }
    save.disabled=true;
    const item={...r,id:r.id || crypto.randomUUID(),created:r.created ?? Date.now(),title,body:content,category:cat.value.trim(),note:note.value.trim()};
    try { await write([item]); $('search').value=''; onlyFavorites=false; draw(); detail(item); notify('Рецепт сохранён'); }
    catch { save.disabled=false; actionError(p); }
  };
}
const attachmentTypes = {'pdf':'application/pdf','jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','webp':'image/webp'};
function dataURL(file,type) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject;
    reader.readAsDataURL(file.slice(0,file.size,type));
  });
}
function validRow(r) {
  if (!r || typeof r.title!=='string' || !r.title.trim() || typeof r.body!=='string') return false;
  const a=r.attachment;
  return !a || (Object.values(attachmentTypes).includes(a.type) && typeof a.name==='string' &&
    typeof a.data==='string' && a.data.startsWith('data:'+a.type+';base64,') && /^[A-Za-z0-9+/]*={0,2}$/.test(a.data.split(',')[1]) && a.data.split(',').length===2);
}
async function parseFile(file) {
  const ext=file.name.split('.').pop().toLowerCase(), title=file.name.replace(/\.[^.]+$/,'');
  if (ext==='json') {
    const book=JSON.parse(await file.text());
    if (book.format!=='recipe-book-v1' || !Array.isArray(book.recipes) || !book.recipes.every(validRow)) throw Error('Выберите файл копии, сохранённый через меню книги.');
    return book.recipes.map(r=>({title:r.title,body:r.body,category:String(r.category || ''),note:String(r.note || ''),favorite:!!r.favorite,attachment:r.attachment || undefined}));
  }
  if (ext==='txt' || ext==='md') {
    const chunks=(await file.text()).trim().split(/^\s*---\s*$/m).map(t=>t.trim()).filter(Boolean);
    return chunks.map(chunk=>{
      const lines=chunk.split(/\r?\n/);
      const headed=lines.length>1 && lines[0].length<=100;
      return {title:headed ? lines.shift().replace(/^#+\s*/,'') : title,body:lines.join('\n').trim(),category:'Мои записи'};
    });
  }
  const type=attachmentTypes[ext];
  if (!type) throw Error('Поддерживаются TXT, MD, PDF, JPG, PNG, WebP и копии книги в JSON.');
  return [{title,body:'',category:ext==='pdf' ? 'Книги' : 'Мои записи',attachment:{name:file.name,type,data:await dataURL(file,type)}}];
}
async function importFiles(files) {
  const p=openPanel('Загрузка в книгу'); p.append(el('p','Читаю файлы…','hint'));
  try {
    const rows=[];
    for(const f of files) rows.push(...await parseFile(f));
    if (!rows.length) throw Error('В файле нет рецептов.');
    if (rows.length===1 && !files.some(f=>/\.json$/i.test(f.name))) { editor(rows[0],true); return; }
    const key=r=>JSON.stringify([r.title,r.body,r.attachment?.data || '']);
    const seen=new Set(recipes.map(key));
    const fresh=rows.filter(r=>{const k=key(r); if(seen.has(k)) return false; seen.add(k); return true;});
    p.replaceChildren(el('p','Новых записей: '+fresh.length+'. Уже в книге или повторяются: '+(rows.length-fresh.length)+'.'));
    if (!fresh.length) return;
    const ul=el('ul');
    fresh.slice(0,10).forEach(r=>ul.append(el('li',r.title))); p.append(ul);
    p.append(button('Добавить в книгу',async e=>{
      const b=e.currentTarget; b.disabled=true;
      try {await write(fresh.map((r,i)=>({...r,id:crypto.randomUUID(),created:Date.now()-i}))); onlyFavorites=false; $('search').value=''; draw(); modal.close(); notify('Записи добавлены');}
      catch {b.disabled=false; actionError(p);}
    },'primary'));
  } catch (err) {p.replaceChildren(); fail(p,err instanceof SyntaxError ? 'Файл JSON повреждён или имеет другой формат.' : err.message || 'Не удалось прочитать файл.'); p.append(button('Выбрать другой файл',importPanel));}
}
function importPanel() {
  const p=openPanel('Загрузить в книгу');
  p.append(el('p','Выберите текст рецепта, фотографию, книгу в PDF или сохранённую копию в JSON.'));
  p.append(el('p','В TXT и MD первую строку используйте для названия. Несколько рецептов разделяйте строкой из трёх дефисов (---). PDF сохраняется целиком.','hint'));
  const inp=el('input'); inp.type='file'; inp.multiple=true; inp.accept='.txt,.md,.pdf,.jpg,.jpeg,.png,.webp,.json'; inp.hidden=true;
  inp.onchange=()=>{if(inp.files.length) importFiles([...inp.files]);};
  p.append(inp,button('Выбрать файлы',()=>inp.click(),'primary'));
}
function menu() {
  const p=openPanel('Меню книги'), list=el('div',undefined,'menulist');
  list.append(button('Загрузить рецепты или книгу',importPanel),button('Скачать копию книги',()=>{
    const blob=new Blob([JSON.stringify({format:'recipe-book-v1',recipes})],{type:'application/json'});
    const url=URL.createObjectURL(blob), a=el('a'); a.href=url; a.download='kniga-receptov.json'; p.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }),button('Добавить на экран телефона',()=>{
    const help=openPanel('На экран телефона');
    help.append(el('h3','iPhone'),el('p','Откройте книгу в Safari. Нажмите «Поделиться», затем «На экран Домой» и «Добавить». Если предложено, включите «Открыть как веб-приложение».'),
      el('h3','Android'),el('p','Откройте меню Chrome ⋮ и выберите «Добавить на главный экран» или «Установить приложение».'));
  })); p.append(list,el('p','Ваши записи хранятся в этом браузере. Скачайте копию, чтобы перенести их на другой телефон.','hint'));
}
$('tools').onclick=menu; $('new').onclick=()=>editor(); $('search').oninput=draw;
$('all').onclick=()=>{onlyFavorites=false;draw();}; $('favorites').onclick=()=>{onlyFavorites=true;draw();};
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();document.body.classList.add('dragging');}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget) document.body.classList.remove('dragging');});
document.addEventListener('drop',e=>{document.body.classList.remove('dragging');if(e.dataTransfer.files.length){e.preventDefault();if(db) importFiles([...e.dataTransfer.files]);}});
(async()=>{
  try {db=await openDB(); await reloadBook(); if(channel) channel.onmessage=reloadBook;}
  catch { $('list').textContent='Хранилище недоступно. Разрешите хранение данных сайта и перезагрузите страницу.'; $('new').disabled=true; }
})();
if ('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>notify('Офлайн-режим пока недоступен'));
