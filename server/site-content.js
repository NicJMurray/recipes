// Shared site content stays separate from recipe seeds, overrides and photos.
// Photo bytes live in the photography repository; D1 stores metadata only.
const PHOTO_ID = /^upload-[a-f0-9-]{36}$/;
const SEED_IDS = new Set(['dscf0008','dscf0195','dscf0218','dscf0232','dscf0233','dscf0241','dscf0297','dscf0415','dscf0429','dscf0468','dscf0470','dscf0477','dscf0509','dscf0512','dscf0643','dscf0679','dscf0703','dscf0706','dscf0707','dscf0881','dscf0907']);
const CONTENT_KEYS = new Set(['section.music','section.literature','section.art','section.food','section.finance','section.tech','description.playlist-finder','description.playlists','description.fresh-tracks','description.books','description.rare-words','description.photography','description.recipes','description.housing','description.scraper','description.paperclip']);
const REPOSITORY = 'NicJMurray/photography';
const MAX_VARIANT = 2000000;
const MAX_HIGH_VARIANT = 6000000;
const SEED_FILES = new Map([...SEED_IDS].map(id=>[`${id.toUpperCase()}.jpg`,id]));
const MEDIA_ORIGIN = 'https://recipes.njmurray.com';
const hex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const hash = async bytes => hex(await crypto.subtle.digest('SHA-256',bytes));
function base64(bytes) {
  if(typeof bytes.toBase64==='function')return bytes.toBase64();
  let value='';
  for(let offset=0;offset<bytes.length;offset+=8192)value+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(value);
}
function mediaFields(row) {
  const base=`${MEDIA_ORIGIN}/media/photography/${row.id}`;
  return {width:row.width,height:row.height,src:`${base}/960.webp`,large:`${base}/1920.webp`,...(row.has_high?{high:`${base}/3840.webp`,highWidth:Math.min(3840,row.width),highHeight:Math.max(1,Math.round(row.height*Math.min(3840,row.width)/row.width))}:{})};
}
function manifestPhoto(row) {
  const media={id:row.media_id||row.id,width:row.media_width||row.width,height:row.media_height||row.height,has_high:row.has_high||0};
  return {id:row.id,file:row.file,title:row.title,alt:row.alt,capturedAt:row.captured_at,createdAt:row.created_at,...mediaFields(media),revision:row.media_revision||0};
}
const PHOTO_QUERY='SELECT p.*,m.id AS media_id,m.width AS media_width,m.height AS media_height,m.has_high,r.revision AS media_revision FROM gallery_photos p LEFT JOIN gallery_replacements r ON r.photo_id=p.id LEFT JOIN gallery_media m ON m.id=COALESCE(r.media_id,p.id)';
async function photoEntry(db,id) {
  return db.prepare(PHOTO_QUERY+' WHERE p.id=? AND p.deleted_at IS NULL').bind(id).first();
}
async function currentMedia(db,id) {
  return db.prepare('SELECT m.*,r.revision FROM gallery_media m JOIN gallery_replacements r ON r.media_id=m.id WHERE r.photo_id=?').bind(id).first()
    .then(async row=>row||await db.prepare('SELECT *,0 AS revision FROM gallery_media WHERE id=?').bind(id).first());
}
function seedReplacement(row,includeFile=false) {
  return {id:row.photo_id,...(includeFile?{file:`${row.photo_id.toUpperCase()}.jpg`}:{}),...mediaFields(row),revision:row.revision};
}
async function replacementEntry(db,target) {
  if(!target.seed)return manifestPhoto(await photoEntry(db,target.id));
  const row=await db.prepare('SELECT m.*,r.revision FROM gallery_media m JOIN gallery_replacements r ON r.media_id=m.id WHERE r.photo_id=?').bind(target.id).first();
  return seedReplacement(row,true);
}
async function replacementTarget(db,file) {
  const candidates=(await db.prepare('SELECT id FROM gallery_photos WHERE file=? COLLATE BINARY AND deleted_at IS NULL').bind(file).all()).results.map(row=>({...row,seed:false}));
  const seed=SEED_FILES.get(file);
  if(seed&&!await db.prepare('SELECT id FROM gallery_hidden WHERE id=?').bind(seed).first())candidates.push({id:seed,seed:true});
  if(candidates.length!==1)return {skipped:true,reason:candidates.length?'ambiguous':'unmatched',file};
  return candidates[0];
}
async function mediaVisible(db,row) {
  if(SEED_IDS.has(row.photo_id))return !await db.prepare('SELECT id FROM gallery_hidden WHERE id=?').bind(row.photo_id).first();
  return Boolean(await db.prepare('SELECT id FROM gallery_photos WHERE id=? AND deleted_at IS NULL').bind(row.photo_id).first());
}
function webpSize(bytes,fail) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const chunk=offset=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  let size=null,canvas=null,imageCount=0;
  for(let offset=12;offset+8<=bytes.length;) {
    const type=chunk(offset),length=view.getUint32(offset+4,true),start=offset+8;
    if(type==='ANIM'||type==='ANMF')fail('Animated images are not supported.');
    if(type==='VP8X') {
      if(length!==10||canvas||(bytes[start]&2))fail('The WebP canvas is invalid.');
      const uint24=p=>bytes[p]+bytes[p+1]*256+bytes[p+2]*65536;
      canvas={width:uint24(start+4)+1,height:uint24(start+7)+1};
    }
    if(type==='VP8 '){
      imageCount++;
      if(length<10||bytes[start+3]!==0x9d||bytes[start+4]!==1||bytes[start+5]!==0x2a)fail('The WebP image is invalid.');
      size={width:view.getUint16(start+6,true)&0x3fff,height:view.getUint16(start+8,true)&0x3fff};
    } else if(type==='VP8L') {
      imageCount++;
      if(length<5||bytes[start]!==0x2f)fail('The WebP image is invalid.');
      const bits=view.getUint32(start+1,true);
      size={width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};
    }
    offset=start+length+(length%2);
  }
  if(imageCount!==1||!size?.width||!size?.height)fail('The WebP image is invalid.');
  if(canvas&&(canvas.width!==size.width||canvas.height!==size.height))fail('The WebP canvas does not match the image.');
  return size;
}
async function github(env,path,method='GET',body) {
  const response=await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`,{method,headers:{'Authorization':`Bearer ${env.PHOTO_GITHUB_TOKEN}`,'User-Agent':'njmurray-photo-editor','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  // Do not include GitHub responses, credentials or private infrastructure in errors.
  if(!response.ok){await response.body?.cancel();const error=new Error('GitHub storage is unavailable.');error.githubStatus=response.status;throw error;}
  return response.json();
}
async function commitPhotos(env,id,variants,HttpError) {
  try {
    // Encode and upload one rendition at a time. HQ files can be 6 MB, so
    // parallel base64/JSON bodies would needlessly increase Worker memory use.
    const blobs=[];
    for(const variant of variants){
      const blob=await github(env,'/git/blobs','POST',{content:base64(variant.bytes),encoding:'base64'});
      blobs.push({width:variant.width,sha:blob.sha});
    }
    for(let attempt=0;attempt<3;attempt++) {
      const ref=await github(env,'/git/ref/heads/main');
      const parent=await github(env,`/git/commits/${ref.object.sha}`);
      const tree=await github(env,'/git/trees','POST',{base_tree:parent.tree.sha,tree:blobs.map(v=>({path:`photos/uploads/${id}/${v.width}.webp`,mode:'100644',type:'blob',sha:v.sha}))});
      const commit=await github(env,'/git/commits','POST',{message:`Publish photograph ${id}`,tree:tree.sha,parents:[ref.object.sha]});
      try {await github(env,'/git/refs/heads/main','PATCH',{sha:commit.sha,force:false});return commit.sha;}
      catch(error){if(![409,422].includes(error.githubStatus)||attempt===2)throw error;}
    }
  } catch(error) {
    if([401,403,404].includes(error.githubStatus))throw new HttpError(503,'GitHub uploads need a valid photography-only token in the protected Cloudflare settings.');
    throw new HttpError(503,'GitHub could not save this photo. Please try uploading it again.');
  }
}

export async function handleSiteContent(request,env,url,helpers) {
  const {json,HttpError,readJson,readBody,cleanWebp,requireSession}=helpers;
  const path=url.pathname;
  if(!path.startsWith('/media/photography/')&&!path.startsWith('/api/shared/gallery')&&path!=='/api/shared/content/homepage')return null;
  if(!env.RECIPES_DB)throw new HttpError(503,'Editing is temporarily unavailable.');
  const db=env.RECIPES_DB;
  if(path.startsWith('/media/photography/')) {
    if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'Method not allowed.');
    const match=path.match(/^\/media\/photography\/((?:upload|replace)-[a-f0-9-]{36})\/(960|1920|3840)\.webp$/);
    if(!match)throw new HttpError(404,'Photo not found.');
    let row=await db.prepare('SELECT * FROM gallery_media WHERE id=?').bind(match[1]).first();
    if(!row&&PHOTO_ID.test(match[1])){
      const original=await db.prepare('SELECT id,commit_sha FROM gallery_photos WHERE id=? AND deleted_at IS NULL').bind(match[1]).first();
      if(original)row={...original,photo_id:original.id,has_high:0};
    }
    if(!row||!/^[a-f0-9]{40}$/.test(row.commit_sha)||!await mediaVisible(db,row)||(match[2]==='3840'&&!row.has_high))throw new HttpError(404,'Photo not found.');
    const file=`photos/uploads/${match[1]}/${match[2]}.webp`;
    // Workers supports manual redirects, but not Fetch's redirect:'error'.
    // Only accept image responses from these two fixed locations, without
    // following redirects or forwarding browser cookies or storage credentials.
    let upstream;
    for(const source of [`https://photography.njmurray.com/${file}`,`https://raw.githubusercontent.com/${REPOSITORY}/${row.commit_sha}/${file}`]) {
      try {
        const response=await fetch(source,{method:request.method,redirect:'manual'});
        if(response.ok&&response.headers.get('content-type')?.split(';')[0].trim()==='image/webp') {
          upstream=response;break;
        }
        await response.body?.cancel();
      } catch {
        // A CDN network error must still allow the immutable GitHub fallback.
      }
    }
    if(!upstream)throw new HttpError(503,'This photo is temporarily unavailable. Please try again shortly.');
    // An immutable Git commit supplies the bytes, so uploads are immediately usable
    // while the existing Pages build catches up. No GitHub credential is sent here.
    return new Response(request.method==='HEAD'?null:upstream.body,{headers:{'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*','Referrer-Policy':'no-referrer'}});
  }
  if(path==='/api/shared/gallery'&&request.method==='GET') {
    const rows=(await db.prepare(PHOTO_QUERY+' WHERE p.deleted_at IS NULL ORDER BY p.file,p.id').all()).results;
    const hidden=(await db.prepare('SELECT id FROM gallery_hidden').all()).results.map(row=>row.id);
    const replacements=(await db.prepare('SELECT m.*,r.revision FROM gallery_media m JOIN gallery_replacements r ON r.media_id=m.id').all()).results.filter(row=>SEED_IDS.has(row.photo_id)&&!hidden.includes(row.photo_id)).map(row=>seedReplacement(row));
    return json({photos:rows.map(manifestPhoto),hidden,available:Boolean(env.PHOTO_GITHUB_TOKEN),replacements});
  }
  if(path==='/api/shared/content/homepage'&&request.method==='GET') {
    const row=await db.prepare('SELECT data,revision FROM site_content WHERE site=?').bind('homepage').first();
    return json({content:row?JSON.parse(row.data):{},revision:row?.revision||0});
  }
  await requireSession(request,env);
  if(['/api/shared/gallery','/api/shared/gallery/replace'].includes(path)&&request.method==='POST') {
    const replacing=path.endsWith('/replace');
    if(!env.PHOTO_GITHUB_TOKEN)throw new HttpError(503,'GitHub uploads need a photography-only token in the protected Cloudflare settings.');
    if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))throw new HttpError(415,'Use the JPEG upload button.');
    const bytes=await readBody(request,MAX_VARIANT*2+MAX_HIGH_VARIANT+16384);
    let form;
    try {form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')}}).formData();}catch{throw new HttpError(400,'The upload could not be read.');}
    let meta;
    try {const raw=form.get('metadata');if(typeof raw!=='string'||raw.length>4096)throw new Error();meta=JSON.parse(raw);}catch{throw new HttpError(422,'Photo details are invalid.');}
    if(!meta||typeof meta.file!=='string'||meta.file.length>180||!/^.+\.jpe?g$/i.test(meta.file)||/[\\/\u0000-\u001f]/.test(meta.file))throw new HttpError(422,'Choose a JPEG with a normal filename.');
    let target,current,revision=0;
    if(replacing){
      target=await replacementTarget(db,meta.file);
      if(target.skipped)return json(target);
      if(meta.photoId!==undefined&&meta.photoId!==target.id)throw new HttpError(409,'This filename now matches a different photograph. Refresh before replacing it.');
      current=await currentMedia(db,target.id);
      revision=current?.revision||0;
      if(meta.revision!==undefined&&(!Number.isInteger(meta.revision)||meta.revision<0))throw new HttpError(422,'The photo version is invalid. Refresh before replacing it.');
      if(meta.revision!==undefined&&meta.revision!==revision)throw new HttpError(409,'This photograph was replaced in another tab. Refresh before replacing it again.');
    }
    if(!Number.isInteger(meta.width)||!Number.isInteger(meta.height)||meta.width<1||meta.height<1||meta.width*meta.height>100000000)throw new HttpError(422,'The image dimensions are invalid.');
    let capturedAt=null;
    if(!replacing&&meta.capturedAt!==null&&meta.capturedAt!==undefined){
      if(typeof meta.capturedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(meta.capturedAt)||!Number.isFinite(Date.parse(meta.capturedAt))||Date.parse(meta.capturedAt)<Date.UTC(1900,0,1)||Date.parse(meta.capturedAt)>Date.now()+86400000)throw new HttpError(422,'The capture date is invalid.');
      capturedAt=new Date(meta.capturedAt).toISOString();
    }
    const label=(value,fallback,max)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))throw new HttpError(422,'The photo description is invalid.');return value.trim();};
    const title=replacing?'':label(meta.title,meta.file.replace(/\.jpe?g$/i,''),180),alt=replacing?'':label(meta.alt,title,400);
    const variants=[];
    for(const [field,width,limit] of [['small',960,MAX_VARIANT],['large',1920,MAX_VARIANT],['high',3840,MAX_HIGH_VARIANT]]) {
      const file=form.get(field);
      if(field==='high'&&!file)continue; // Old editors may still send two renditions.
      if(!file||typeof file==='string'||file.type!=='image/webp'||file.size>limit)throw new HttpError(422,`The ${width}px WebP must be smaller than ${limit/1000000} MB.`);
      const clean=cleanWebp(new Uint8Array(await file.arrayBuffer()));
      const size=webpSize(clean,message=>{throw new HttpError(422,message);});
      const expectedWidth=Math.min(meta.width,width),expectedHeight=Math.max(1,Math.round(meta.height*expectedWidth/meta.width));
      if(size.width!==expectedWidth||size.height!==expectedHeight)throw new HttpError(422,'The resized photo dimensions do not match.');
      variants.push({width,bytes:clean});
    }
    const fingerprint=await hash(variants[1].bytes),hasHigh=variants.length===3,highFingerprint=hasHigh?await hash(variants[2].bytes):'';
    if(replacing){
      if(current&&current.fingerprint===fingerprint&&current.high_fingerprint===highFingerprint&&current.width===meta.width&&current.height===meta.height)return json({photo:await replacementEntry(db,target),replaced:true,duplicate:true});
      const mediaId=`replace-${crypto.randomUUID()}`,commit=await commitPhotos(env,mediaId,variants,HttpError),now=new Date().toISOString();
      const results=await db.batch([
        db.prepare('INSERT INTO gallery_media (id,photo_id,commit_sha,fingerprint,high_fingerprint,width,height,has_high,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(mediaId,target.id,commit,fingerprint,highFingerprint,meta.width,meta.height,hasHigh?1:0,now),
        db.prepare('INSERT INTO gallery_replacements (photo_id,media_id,revision) SELECT ?,?,? WHERE ((?=1 AND NOT EXISTS(SELECT 1 FROM gallery_hidden WHERE id=?)) OR (?=0 AND EXISTS(SELECT 1 FROM gallery_photos WHERE id=? AND deleted_at IS NULL))) AND (?=0 OR EXISTS(SELECT 1 FROM gallery_replacements WHERE photo_id=? AND revision=?)) ON CONFLICT(photo_id) DO UPDATE SET media_id=excluded.media_id,revision=excluded.revision WHERE gallery_replacements.revision=? RETURNING revision').bind(target.id,mediaId,revision+1,target.seed?1:0,target.id,target.seed?1:0,target.id,revision,target.id,revision,revision),
      ]);
      if(!results[1].results?.length){
        await db.prepare('DELETE FROM gallery_media WHERE id=? AND NOT EXISTS(SELECT 1 FROM gallery_replacements WHERE media_id=?)').bind(mediaId,mediaId).run();
        throw new HttpError(409,'This photograph changed while it was uploading. Refresh before replacing it again.');
      }
      return json({photo:await replacementEntry(db,target),replaced:true});
    }
    const previous=await db.prepare('SELECT p.* FROM gallery_photos p LEFT JOIN gallery_replacements r ON r.photo_id=p.id LEFT JOIN gallery_media m ON m.id=r.media_id WHERE p.deleted_at IS NULL AND (p.fingerprint=? OR m.fingerprint=?) LIMIT 1').bind(fingerprint,fingerprint).first();
    if(previous)return json({photo:manifestPhoto(await photoEntry(db,previous.id)),duplicate:true});
    const id=`upload-${crypto.randomUUID()}`,commit=await commitPhotos(env,id,variants,HttpError);
    const now=new Date().toISOString();
    try {
      await db.batch([
        db.prepare('INSERT INTO gallery_photos (id,file,title,alt,width,height,captured_at,commit_sha,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,meta.file,title,alt,meta.width,meta.height,capturedAt,commit,fingerprint,now),
        db.prepare('INSERT INTO gallery_media (id,photo_id,commit_sha,fingerprint,high_fingerprint,width,height,has_high,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,id,commit,fingerprint,highFingerprint,meta.width,meta.height,hasHigh?1:0,now),
      ]);
    } catch(error) {
      const duplicate=await db.prepare('SELECT * FROM gallery_photos WHERE fingerprint=? AND deleted_at IS NULL').bind(fingerprint).first();
      if(duplicate)return json({photo:manifestPhoto(await photoEntry(db,duplicate.id)),duplicate:true});
      throw error;
    }
    return json({photo:manifestPhoto(await photoEntry(db,id))},201);
  }
  const deletion=path.match(/^\/api\/shared\/gallery\/([^/]+)$/);
  if(deletion&&request.method==='DELETE') {
    const id=deletion[1];
    if(SEED_IDS.has(id))await db.prepare('INSERT OR IGNORE INTO gallery_hidden (id) VALUES (?)').bind(id).run();
    else if(PHOTO_ID.test(id))await db.prepare('UPDATE gallery_photos SET deleted_at=? WHERE id=?').bind(new Date().toISOString(),id).run();
    else throw new HttpError(404,'Photo not found.');
    // Removing a public photo does not rewrite Git history. Original files remain
    // recoverable in GitHub; the public manifest and media route stop exposing it.
    return json({removed:true,id});
  }
  if(path==='/api/shared/content/homepage'&&request.method==='PUT') {
    const body=await readJson(request,20000);
    if(!Number.isInteger(body.revision)||body.revision<0||!body.content||typeof body.content!=='object'||Array.isArray(body.content))throw new HttpError(422,'The content version or text is missing.');
    const content={};
    for(const [key,value] of Object.entries(body.content)) {
      if(!CONTENT_KEYS.has(key)||typeof value!=='string'||!value.trim()||value.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new HttpError(422,'One of the text fields is invalid.');
      content[key]=value.trim();
    }
    const result=await db.prepare('INSERT INTO site_content (site,revision,data,updated_at) SELECT ?,?,?,? WHERE ?=0 OR EXISTS (SELECT 1 FROM site_content WHERE site=? AND revision=?) ON CONFLICT(site) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at WHERE site_content.revision=? RETURNING revision').bind('homepage',body.revision+1,JSON.stringify(content),new Date().toISOString(),body.revision,'homepage',body.revision,body.revision).all();
    if(!result.results?.length)throw new HttpError(409,'This text was updated in another tab. Your draft is still here; reload before saving again.');
    return json({content,revision:body.revision+1});
  }
  throw new HttpError(405,'That editing action is not supported.');
}
