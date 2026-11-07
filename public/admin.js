(() => {
  'use strict';
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const login=$('#admin-login'),controls=$('#admin-controls'),root=$('#editor-root'),main=$('#main');
  const loginDialog=$('#login-dialog'),draftDialog=$('#draft-dialog');
  const slug=main?.dataset.slug;
  const MODE_KEY='njmurray-recipes:admin-mode';
  let authenticated=false,mode='published',current=null,dirty=false,saving=false,pendingPhoto=null,previewUrl=null,photoChoice=null,photoBusy=false;
  try{if(localStorage.getItem(MODE_KEY)==='edit')mode='edit';}catch{}

  async function api(path,options={}) {
    const response=await fetch(path,{credentials:'same-origin',...options});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error||'Please try again.');error.status=response.status;throw error;}
    return data;
  }
  const jsonOptions=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function setMode(value){mode=value;try{localStorage.setItem(MODE_KEY,value);}catch{}}
  function status(message,error=false){const target=$('#editor-status');if(target){target.textContent=message;target.classList.toggle('is-error',error);}}
  function markDirty(){dirty=true;status('Unsaved changes');updateSave();}
  function updateSave(){$$('[data-save]',root).forEach(b=>b.disabled=saving||photoBusy||!dirty);}
  function syncControls(){
    login.hidden=authenticated;controls.hidden=!authenticated;
    document.body.classList.toggle('is-admin',authenticated);
    document.body.classList.toggle('is-edit-mode',authenticated&&mode==='edit');
    $$('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
  }
  function addCardLinks(){
    $$('[data-editor-link]').forEach(link=>link.remove());
    if(!authenticated||mode!=='edit')return;
    $$('.recipe-card').forEach(card=>{
      const original=$('h2 a',card);if(!original)return;
      const link=document.createElement('a');link.href=original.href;link.className='card-edit';link.dataset.editorLink='';link.textContent='Edit';link.setAttribute('aria-label',`Edit ${original.textContent}`);
      $('.card-photo-wrap',card).append(link);
    });
  }
  function showPublished(){
    root.hidden=true;main.hidden=false;$('.skip').href='#main';addCardLinks();
  }
  async function enterMode(){
    syncControls();addCardLinks();
    if(!authenticated||mode!=='edit'||!slug){showPublished();return;}
    try{
      current=await api(`/api/recipes/${slug}`);renderEditor();
    }catch(error){
      setMode('published');syncControls();showPublished();
      const message=document.createElement('p');message.className='editor-load-error';message.textContent=error.message;main.prepend(message);
    }
  }
  function draftChoice(){
    return new Promise(resolve=>{
      const click=event=>{const button=event.target.closest('[data-draft]');if(!button)return;finish(button.dataset.draft);};
      const cancel=event=>{event.preventDefault();finish('cancel');};
      function finish(value){draftDialog.close();draftDialog.removeEventListener('click',click);draftDialog.removeEventListener('cancel',cancel);resolve(value);}
      draftDialog.addEventListener('click',click);draftDialog.addEventListener('cancel',cancel);draftDialog.showModal();
    });
  }
  async function leaveDraft(){
    if(!dirty)return true;
    const choice=await draftChoice();
    if(choice==='cancel')return false;
    if(choice==='save')return save();
    dirty=false;return true;
  }
  controls.addEventListener('click',async event=>{
    const target=event.target.closest('[data-mode]');if(!target||saving)return;
    const value=target.dataset.mode;if(value===mode)return;
    if(!await leaveDraft())return;
    setMode(value);
    // Refresh public HTML after saves rather than displaying the old page copy.
    if(value==='published'&&slug){location.reload();return;}
    await enterMode();
  });
  login.addEventListener('click',()=>{loginDialog.showModal();$('input[name=username]',loginDialog).focus();});
  $('[data-close-login]').addEventListener('click',()=>loginDialog.close());
  $('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=$('button[type=submit]',form),message=$('#login-status');
    button.disabled=true;message.textContent='Logging in…';
    try{
      await api('/api/login',jsonOptions('POST',{username:form.elements.username.value,password:form.elements.password.value}));
      authenticated=true;form.elements.password.value='';message.textContent='';loginDialog.close();
      if(!current)setMode('published');
      syncControls();addCardLinks();
    }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
  });
  $('#admin-logout').addEventListener('click',async()=>{
    if(saving||!await leaveDraft())return;
    try{await api('/api/logout',{method:'POST'});dirty=false;setMode('published');location.reload();}catch(error){status(error.message,true);}
  });
  document.addEventListener('click',async event=>{
    const link=event.target.closest('a[href]');
    if(!dirty||!link||link.getAttribute('href').startsWith('#')||event.defaultPrevented||event.ctrlKey||event.metaKey||link.target==='_blank')return;
    event.preventDefault();if(saving||!await leaveDraft())return;location.assign(link.href);
  });
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});

  const field=(label,name,value,{area=false,type='text',max=120,extra=''}={})=>`<label class="editor-field">${label}${area?`<textarea name="${name}" rows="3" maxlength="${max}" ${extra}>${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" maxlength="${max}" ${extra}>`}</label>`;
  const rowButtons=label=>`<div class="row-tools"><button type="button" data-move="up" aria-label="Move ${label} up" title="Move up">↑</button><button type="button" data-move="down" aria-label="Move ${label} down" title="Move down">↓</button><button type="button" data-remove aria-label="Remove ${label}" title="Remove">×</button></div>`;
  const handle=label=>`<button type="button" class="row-drag" data-drag aria-label="Drag to reorder ${label}" title="Drag to reorder"><span aria-hidden="true">⠿</span></button>`;
  const ingredientRow=item=>`<div class="edit-row" data-row="ingredient">${handle('ingredient')}<input data-ingredient-value aria-label="Ingredient" maxlength="500" value="${esc(item)}" required>${rowButtons('ingredient')}</div>`;
  const stepRow=step=>`<div class="edit-row step-editor-row" data-row="step">${handle('step')}<div class="step-editor-copy"><span class="editor-step-number"></span><label class="sr-only">Step title</label><input data-step-title aria-label="Step title" placeholder="Step title" maxlength="140" value="${esc(step.title)}"><textarea data-step-text aria-label="Step instructions" placeholder="What happens in this step?" rows="3" maxlength="6000" required>${esc(step.text)}</textarea></div>${rowButtons('step')}</div>`;
  const noteRow=note=>`<div class="edit-row" data-row="note"><textarea data-note-value aria-label="Recipe note" rows="2" maxlength="1600">${esc(note)}</textarea>${rowButtons('note')}</div>`;
  const groupMarkup=group=>`<div class="ingredient-editor-group" data-group><div class="editor-group-heading"><label class="sr-only">Ingredient section title</label><input data-group-title aria-label="Ingredient section title" maxlength="100" value="${esc(group.title)}" required><div class="row-tools"><button type="button" data-group-move="up" aria-label="Move ingredient section up">↑</button><button type="button" data-group-move="down" aria-label="Move ingredient section down">↓</button><button type="button" data-remove-group aria-label="Remove ingredient section">×</button></div></div><div class="edit-list" data-list="ingredient">${group.items.map(ingredientRow).join('')}</div><button type="button" data-add-ingredient class="editor-add">+ Ingredient</button></div>`;
  function renderEditor(){
    const r=current.recipe;photoChoice={...current.photo};pendingPhoto=null;dirty=false;
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
    root.innerHTML=`<div class="editor-topbar"><a class="back-link" href="/">← All recipes</a><div><span id="editor-status" class="admin-status" role="status" aria-live="polite">Editing recipe</span><button type="button" data-discard class="editor-quiet">Discard</button><button type="button" data-save class="editor-primary" disabled>Save changes</button></div></div>
      <form id="recipe-editor"><section class="editor-section editor-heading"><p class="eyebrow">YOUR RECIPE BOOK · EDIT MODE</p><h1>Edit recipe.</h1>${field('Title','title',r.title,{max:160,extra:'required'})}${field('Description','description',r.description,{area:true,max:1600,extra:'required'})}<div class="editor-field-grid"><label class="editor-field">Meal<select name="mealType">${['Breakfast','Lunch','Dinner'].map(x=>`<option ${x===r.mealType?'selected':''}>${x}</option>`).join('')}</select></label><label class="editor-field">Category<select name="category">${['Fish & seafood','Vegetarian'].map(x=>`<option ${x===r.category?'selected':''}>${x}</option>`).join('')}</select></label>${field('Tags, separated by commas','tags',r.tags.join(', '),{max:1000})}</div></section>
      <section class="editor-section"><h2>The details.</h2><div class="editor-field-grid">${[['Serves','servings'],['Prep time','prep'],['Cook time','cook'],['Time shown on cards','timeLabel'],['Oven temperature','temperature']].map(([label,key])=>field(label,key,r[key]||'')).join('')}${field('Total minutes (for the quick filter)','totalMinutes',r.totalMinutes??'',{type:'number',extra:'min="1" max="10080" step="1"'})}</div></section>
      <section class="editor-section"><div class="editor-section-heading"><h2>Ingredients.</h2><span>Drag the dots or use the arrows to reorder.</span></div><div id="ingredient-groups">${r.ingredients.map(groupMarkup).join('')}</div><button type="button" data-add-group class="editor-add">+ Ingredient section</button></section>
      <section class="editor-section"><h2>The method.</h2><div class="edit-list" id="method-steps" data-list="step">${r.steps.map(stepRow).join('')}</div><button type="button" data-add-step class="editor-add">+ Method step</button></section>
      <section class="editor-section"><h2>Photo.</h2><div class="editor-photo-layout"><img id="editor-photo" src="${esc(current.photo.url)}" alt="Recipe photo preview"><div><label class="editor-upload">Choose photo<input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"></label><p class="editor-hint" id="photo-status" role="status">Your photo will be resized for the web. It publishes when you save.</p><button type="button" data-original-photo class="editor-quiet">Use original photo</button><div id="photo-fields" ${photoChoice.kind==='upload'?'':'hidden'}>${field('Photo description','photoAlt',photoChoice.kind==='upload'?photoChoice.alt:r.title,{max:400})}${field('Photo credit (optional)','photoCredit',photoChoice.kind==='upload'?photoChoice.credit:'',{max:160})}</div></div></div></section>
      <section class="editor-section"><h2>Recipe notes.</h2><div data-list="note" id="recipe-notes">${(r.notes||[]).map(noteRow).join('')}</div><button type="button" data-add-note class="editor-add">+ Note</button></section>
      <div class="editor-bottom"><p class="editor-hint">Save changes publishes this recipe for everyone.</p><button type="button" data-save class="editor-primary" disabled>Save changes</button></div></form>`;
    root.hidden=false;main.hidden=true;$('.skip').href='#editor-root';renumber();updateSave();
  }
  function renumber(){$$('[data-row=step]',root).forEach((row,i)=>$('.editor-step-number',row).textContent=`Step ${i+1}`);}
  root.addEventListener('input',markDirty);
  root.addEventListener('submit',event=>{event.preventDefault();});
  root.addEventListener('change',async event=>{if(event.target.id==='photo-file')await choosePhoto(event.target.files[0]);});
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||saving)return;
    if(button.hasAttribute('data-save')){await save();return;}
    if(button.hasAttribute('data-discard')){if(!dirty||await leaveDraft()){current=await api(`/api/recipes/${slug}`);renderEditor();}return;}
    if(button.hasAttribute('data-original-photo')){
      pendingPhoto=null;photoChoice={kind:'original'};$('#photo-fields').hidden=true;
      // The original URL is returned by the server only for the original photo.
      $('#editor-photo').hidden=true;$('#photo-status').textContent='The original photo will be restored when you save.';markDirty();return;
    }
    if(button.hasAttribute('data-add-ingredient')){
      const list=$('[data-list=ingredient]',button.closest('[data-group]'));list.insertAdjacentHTML('beforeend',ingredientRow(''));$('[data-row]:last-child input',list).focus();
    }else if(button.hasAttribute('data-add-group')){
      $('#ingredient-groups').insertAdjacentHTML('beforeend',groupMarkup({title:'Ingredients',items:['']}));$('#ingredient-groups [data-group]:last-child [data-group-title]').focus();
    }else if(button.hasAttribute('data-add-step')){
      $('#method-steps').insertAdjacentHTML('beforeend',stepRow({title:'',text:''}));$('#method-steps [data-row]:last-child input').focus();
    }else if(button.hasAttribute('data-add-note')){
      $('#recipe-notes').insertAdjacentHTML('beforeend',noteRow(''));$('#recipe-notes [data-row]:last-child textarea').focus();
    }else if(button.hasAttribute('data-remove')){button.closest('[data-row]').remove();
    }else if(button.dataset.move){move(button.closest('[data-row]'),button.dataset.move);
    }else if(button.hasAttribute('data-remove-group')){button.closest('[data-group]').remove();
    }else if(button.dataset.groupMove){move(button.closest('[data-group]'),button.dataset.groupMove);
    }else return;
    renumber();markDirty();
  });
  function move(row,direction){const sibling=direction==='up'?row.previousElementSibling:row.nextElementSibling;if(!sibling)return;if(direction==='up')sibling.before(row);else sibling.after(row);}
  let drag=null;
  root.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-drag]');if(!handle||saving||event.button!==0)return;
    const row=handle.closest('[data-row]');drag={row,list:row.parentElement,handle,id:event.pointerId,moved:false};
    handle.setPointerCapture(event.pointerId);row.classList.add('is-dragging');event.preventDefault();
  });
  root.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const rows=[...drag.list.children].filter(row=>row!==drag.row);
    const before=rows.find(row=>event.clientY<row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);
    const previous=drag.row.nextElementSibling;
    if(before)drag.list.insertBefore(drag.row,before);else drag.list.append(drag.row);
    if(previous!==drag.row.nextElementSibling){drag.moved=true;renumber();}
  });
  function endDrag(){if(!drag)return;drag.row.classList.remove('is-dragging');if(drag.moved)markDirty();drag=null;}
  root.addEventListener('pointerup',endDrag);root.addEventListener('pointercancel',endDrag);

  async function choosePhoto(file){
    if(!file)return;const message=$('#photo-status');
    photoBusy=true;$('#photo-file').disabled=true;updateSave();message.textContent='Preparing photo…';
    try{
      if(file.size>35*1024*1024)throw new Error('Choose a photo smaller than 35 MB.');
      if(!/^image\/(jpeg|png|webp|avif|heic|heif)$/i.test(file.type))throw new Error('Choose a JPEG, PNG, WebP or AVIF photo.');
      let bitmap;
      try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw new Error('This photo format cannot be opened here. Try a JPEG or PNG copy.');}
      const canvas=document.createElement('canvas');let longest=Math.min(1800,Math.max(bitmap.width,bitmap.height)),blob;
      for(let tries=0;tries<5;tries++){
        const scale=Math.min(1,longest/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.86-tries*0.07));
        if(blob?.type==='image/webp'&&blob.size<=1000000)break;longest*=0.75;
      }
      bitmap.close();if(!blob||blob.type!=='image/webp'||blob.size>1000000)throw new Error('This photo could not be resized. Try a smaller image.');
      if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);pendingPhoto=blob;photoChoice={kind:'pending'};
      $('#editor-photo').src=previewUrl;$('#editor-photo').hidden=false;$('#photo-fields').hidden=false;
      if(!$('[name=photoAlt]').value)$('[name=photoAlt]').value=$('[name=title]').value;
      message.textContent='Photo ready. Save changes to publish it.';markDirty();
    }catch(error){message.textContent=error.message;}finally{photoBusy=false;$('#photo-file').disabled=false;updateSave();}
  }
  function collect(){
    const form=$('#recipe-editor'),r={...current.recipe};
    for(const key of ['title','description','category','mealType','servings','prep','cook','timeLabel','temperature'])r[key]=form.elements[key].value;
    r.tags=form.elements.tags.value.split(',').map(s=>s.trim()).filter(Boolean);
    r.totalMinutes=form.elements.totalMinutes.value===''?null:Number(form.elements.totalMinutes.value);
    r.ingredients=$$('[data-group]',form).map(group=>({title:$('[data-group-title]',group).value,items:$$('[data-ingredient-value]',group).map(input=>input.value)}));
    r.steps=$$('[data-row=step]',form).map(row=>({title:$('[data-step-title]',row).value,text:$('[data-step-text]',row).value}));
    r.notes=$$('[data-note-value]',form).map(input=>input.value).filter(s=>s.trim());return r;
  }
  async function save(){
    if(saving||photoBusy)return false;
    if(!$('#recipe-editor').reportValidity())return false;
    saving=true;updateSave();root.classList.add('is-saving');status('Saving…');
    try{
      const recipe=collect();$$('input,select,textarea,button',root).forEach(el=>el.disabled=true);let photo={...photoChoice};
      if(pendingPhoto){const uploaded=await api('/api/photos',{method:'POST',headers:{'Content-Type':'image/webp'},body:pendingPhoto});photo={kind:'upload',id:uploaded.id};}
      if(photo.kind==='upload'){photo.alt=$('[name=photoAlt]').value;photo.credit=$('[name=photoCredit]').value;}
      const saved=await api(`/api/recipes/${slug}`,jsonOptions('PUT',{recipe,photo,revision:current.revision}));
      current=saved;renderEditor();status('Saved. Changes are live.');return true;
    }catch(error){
      status(error.message,true);
      if(error.status===401){authenticated=false;syncControls();login.hidden=false;$('#login-status').textContent='Log in again to save your draft.';loginDialog.showModal();}
      return false;
    }finally{saving=false;root.classList.remove('is-saving');$$('input,select,textarea,button',root).forEach(el=>el.disabled=false);updateSave();}
  }
  api('/api/session').then(data=>{
    authenticated=data.authenticated;login.hidden=!data.available;syncControls();login.hidden=!data.available||authenticated;
    if(authenticated)enterMode();else{setMode('published');showPublished();}
  }).catch(()=>{login.hidden=true;});
})();
