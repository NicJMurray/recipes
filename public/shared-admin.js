// Shared, dependency-free editor client. Authentication stays on the recipes
// host; no password, session token or deployment credential is stored here.
const API_ORIGIN='https://recipes.njmurray.com';

export async function request(path,options={}) {
  if(typeof path!=='string'||!path.startsWith('/api/shared/'))throw new Error('Use a shared editor API path.');
  const headers=new Headers(options.headers);
  let body=options.body;
  if(body&&Object.getPrototypeOf(body)===Object.prototype){
    headers.set('Content-Type','application/json');body=JSON.stringify(body);
  }
  let response;
  try{response=await fetch(API_ORIGIN+path,{...options,headers,body,credentials:'include',cache:'no-store'});}
  catch{throw new Error('Could not reach the editor. Check your connection and try again.');}
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error(data?.error||'The editor could not complete this action. Please try again.');
    error.status=response.status;throw error;
  }
  return data;
}

export const getSession=()=>request('/api/shared/session');

export function mountAdmin({container,onSessionChange=()=>{}}) {
  if(!(container instanceof Element))throw new Error('Choose a container for the editor controls.');
  const element=document.createElement('span');element.className='site-admin';
  element.innerHTML='<button type="button" data-admin-login hidden>Log in</button><button type="button" data-admin-logout hidden>Log out</button><dialog class="site-admin-dialog"><form method="dialog" data-admin-form><div class="site-admin-heading"><h2>Log in</h2><button type="button" data-admin-close aria-label="Close login">×</button></div><label>Username<input name="username" autocomplete="username" maxlength="100" required></label><label>Passphrase<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label><p data-admin-status role="status" aria-live="polite"></p><button type="submit">Log in</button></form></dialog>';
  container.append(element);
  const select=selector=>element.querySelector(selector);
  const loginButton=select('[data-admin-login]'),logoutButton=select('[data-admin-logout]');
  const dialog=select('dialog'),form=select('form'),message=select('[data-admin-status]');
  let current={authenticated:false,available:false},busy=false;
  function publish(state){
    current=state;
    loginButton.hidden=!state.available||state.authenticated;
    logoutButton.hidden=!state.authenticated;
    onSessionChange(state);
    element.dispatchEvent(new CustomEvent('njmurray:session',{detail:state,bubbles:true}));
    return state;
  }
  async function refresh(){
    try{return publish(await getSession());}
    catch{return publish({authenticated:false,available:false});}
  }
  function openLogin(){
    if(dialog.open)return;
    message.textContent='';dialog.showModal();form.elements.username.focus();
  }
  loginButton.addEventListener('click',openLogin);
  select('[data-admin-close]').addEventListener('click',()=>dialog.close());
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;
    const button=select('button[type=submit]');button.disabled=true;message.textContent='Logging in…';
    try{
      const state=await request('/api/shared/login',{method:'POST',body:{username:form.elements.username.value,password:form.elements.password.value}});
      form.elements.password.value='';dialog.close();publish({...state,available:true});
    }catch(error){message.textContent=error.message;}
    finally{button.disabled=false;busy=false;}
  });
  logoutButton.addEventListener('click',async()=>{
    if(busy)return;busy=true;logoutButton.disabled=true;
    try{await request('/api/shared/logout',{method:'POST'});publish({authenticated:false,available:true});}
    catch(error){message.textContent=error.message;dialog.showModal();}
    finally{busy=false;logoutButton.disabled=false;}
  });
  // A login or logout in another subdomain is picked up on returning to a tab.
  window.addEventListener('focus',()=>{if(!busy&&!dialog.open)refresh();});
  const ready=refresh();
  return {ready,refresh,openLogin,element,get authenticated(){return current.authenticated;}};
}
