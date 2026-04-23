(function(){var t=localStorage.getItem('snapbook-theme')||'light';document.documentElement.setAttribute('data-theme',t);})();

// ─────────────────────

(function(){var COLORS={Morado:{light:"#6c63ff",dark:"#6c63ff"},Azul:{light:"#1877f2",dark:"#4da3ff"},Rosa:{light:"#e91e8c",dark:"#ff6eb4"},Verde:{light:"#2ecc71",dark:"#43ef7b"},Naranja:{light:"#f39c12",dark:"#ffb347"},Rojo:{light:"#e74c3c",dark:"#ff6b6b"},Cyan:{light:"#00bcd4",dark:"#26d9f0"},Dorado:{light:"#d4a017",dark:"#ffd700"}};var saved=localStorage.getItem("snapbook-accent")||"Morado";var color=COLORS[saved]||COLORS["Morado"];var isDark=document.documentElement.getAttribute("data-theme")==="dark";document.documentElement.style.setProperty("--accent",isDark?color.dark:color.light);})();

// ─────────────────────

import { auth } from './firebase-config.js';
        import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
        
        import { sincronizarUsuario, contarVisitas30Dias } from './db.js';
        import { uploadAvatar, uploadCover } from './supabase-config.js';
        import { obtenerPuntos, obtenerHistorial, checkLoginDiario, getNivel } from './points.js';

        let currentUser = null, allPosts = [], allShorts = [], activeTab = 'posts';

        function animateCount(el, target) {
            if (!el) return;
            const dur = 600, start = performance.now(), from = parseInt(el.textContent) || 0;
            if (from === target) return;
            const step = ts => { const p = Math.min((ts-start)/dur,1); el.textContent=Math.round(from+(target-from)*(1-Math.pow(1-p,3))); if(p<1)requestAnimationFrame(step); else el.textContent=target; };
            requestAnimationFrame(step);
        }

        function setBio(text) {
            const el = document.getElementById('profile-bio');
            if (!text) { el.textContent='¡Hola! Estoy usando SnapBook 📸✨'; return; }
            if (text.length<=100) { el.textContent=text; return; }
            el.innerHTML=`${text.substring(0,100)}<span id="bio-hidden" style="display:none">${text.substring(100)}</span>… <span class="bio-toggle" onclick="expandBio()">Ver más</span>`;
        }
        window.expandBio=()=>{ document.getElementById('bio-hidden').style.display='inline'; document.querySelector('.bio-toggle')?.remove(); };

        function buildInfoRows(ud) {
            const rows=document.getElementById('info-rows'), meta=document.getElementById('profile-meta');
            const items=[];
            if(ud.ciudad)          items.push({icon:'fa-location-dot',label:ud.ciudad,sub:'Ciudad actual'});
            if(ud.hometown)        items.push({icon:'fa-house',label:ud.hometown,sub:'Ciudad natal'});
            if(ud.trabajo)         items.push({icon:'fa-briefcase',label:ud.trabajo,sub:'Empleo'});
            if(ud.escuela)         items.push({icon:'fa-graduation-cap',label:ud.escuela,sub:'Educación'});
            if(ud.fechaNacimiento) items.push({icon:'fa-cake-candles',label:ud.fechaNacimiento,sub:'Cumpleaños'});
            rows.innerHTML = items.length
                ? items.map(it=>`<div class="info-row"><div class="info-icon"><i class="fa-solid ${it.icon}"></i></div><div><div class="info-label">${it.label}</div><div class="info-sub">${it.sub}</div></div></div>`).join('')
                : `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:8px 0;">Sin datos aún — <span style="color:var(--accent);cursor:pointer;font-weight:700;" onclick="location.href='settings.html'">Editar perfil</span></div>`;
            const mi=[];
            if(ud.ciudad)  mi.push(`<div class="meta-item"><i class="fa-solid fa-location-dot"></i>${ud.ciudad}</div>`);
            if(ud.trabajo) mi.push(`<div class="meta-item"><i class="fa-solid fa-briefcase"></i>${ud.trabajo}</div>`);
            if(ud.escuela) mi.push(`<div class="meta-item"><i class="fa-solid fa-graduation-cap"></i>${ud.escuela}</div>`);
            meta.innerHTML=mi.join('');
        }

        function renderNivel(pts) {
            const n=getNivel(pts);
            document.getElementById('nivel-icono').textContent=n.icono;
            document.getElementById('nivel-nombre').textContent=`Nivel ${n.nivel} · ${n.nombre}`;
            document.getElementById('nivel-pts-txt').textContent=pts.toLocaleString();
            document.getElementById('nivel-pct').textContent=n.progreso+'%';
            setTimeout(()=>{ document.getElementById('nivel-barra').style.width=n.progreso+'%'; },100);
            document.getElementById('nivel-next').textContent=n.siguiente?`Siguiente: ${n.siguiente.nombre} (${n.siguiente.min.toLocaleString()} pts)`:'👑 ¡Nivel máximo!';
        }

        function showToast(msg) {
            const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
            setTimeout(()=>t.classList.remove('show'),2500);
        }
        function openImgFull(url) {
            const ov=document.createElement('div'); ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
            ov.innerHTML=`<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;">`; ov.onclick=()=>ov.remove(); document.body.appendChild(ov);
        }
        function timeAgo(ts) {
            const d=Math.floor((Date.now()-Number(ts))/1000);
            if(d<60)return'Hace un momento'; if(d<3600)return`Hace ${Math.floor(d/60)} min`; if(d<86400)return`Hace ${Math.floor(d/3600)} h`;
            return new Date(Number(ts)).toLocaleDateString('es-MX',{day:'numeric',month:'short'});
        }

        // ── Auth ──
        
// ── GUARDIA DE AUTENTICACIÓN ──────────────────────────────────────
const _authTimeout = setTimeout(() => { location.replace('index.html'); }, 6000);
onAuthStateChanged(auth, async (user) => {
            clearTimeout(_authTimeout); if (!user || !user.uid) { location.replace('index.html'); return; }
            currentUser = user;
    window.__snapbookUser = user;

            // ── GUARDIA DE PERFIL ──
            try {
                                const pgRows = await tursoQuery('SELECT nombre, avatar FROM usuarios WHERE uid = ?', [user.uid]).catch(()=>[]);
                const pgData = pgRows[0] || {};
                const _pgFoto = pgData.avatar || user.photoURL || '';
                const _pgFotoOk = _pgFoto.length > 10 && (_pgFoto.startsWith('http') || _pgFoto.startsWith('data:'));
                const _pgNombreOk = !!(pgData.nombre || user.displayName || '').trim();
                if (!_pgFotoOk || !_pgNombreOk) { location.replace('register.html?completar=1'); return; }
            } catch(e) { }

            // Mostrar datos básicos inmediatamente desde Auth
            const initName = user.displayName || user.email?.split('@')[0] || 'Usuario';
            const initAvatar = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(initName.charAt(0))}&background=6c63ff&color=fff`;
            document.getElementById('profile-name').textContent = initName;
            document.getElementById('profile-avatar').src = initAvatar;

            // Sincronizar en background (no bloquea la carga)
            sincronizarUsuario(user).then(()=>{}).catch(()=>{});

            try {
                const usRows = await tursoQuery('SELECT nombre, avatar FROM usuarios WHERE uid = ?', [user.uid]).catch(()=>[]);
                const ud = usRows[0] || {};
                document.getElementById('profile-name').textContent = ud.nombre || user.displayName || 'Usuario';
                setBio(ud.bio || '');
                const avatarUrl = ud.avatar || user.photoURL || '';
                if (avatarUrl) document.getElementById('profile-avatar').src = avatarUrl;
                buildInfoRows(ud);
                
            } catch(e){  buildInfoRows({}); }

            try {
                
                let vc=0;
                try{ vc=await contarVisitas30Dias(user.uid); }
                catch(e){
                    const vsRows = await tursoQuery('SELECT COUNT(*) as n FROM visitas_perfil WHERE uid = ? AND timestamp > ?', [user.uid, Date.now()-30*24*60*60*1000]).catch(()=>[{n:0}]);
                    // visitas calculadas desde Turso
                }
                document.getElementById('stat-visits').textContent=vc>999?Math.floor(vc/1000)+'k':vc;
                
            } catch(e){  }

            try {
                                tursoQuery('SELECT COUNT(*) as n FROM seguidores WHERE uid = ?', [user.uid]).then(r => {
                    animateCount(document.getElementById('stat-followers'), Number(r[0]?.n||0));
                }).catch(()=>{});
                tursoQuery('SELECT COUNT(*) as n FROM seguidores WHERE seguidor_uid = ?', [user.uid]).then(r => {
                    animateCount(document.getElementById('stat-following'), Number(r[0]?.n||0));
                }).catch(()=>{});
                
            } catch(e){  }

            try {
                checkLoginDiario(user.uid).catch(()=>{});
                const pts=await obtenerPuntos(user.uid); renderNivel(pts);
                
            } catch(e){  }

            try {
                const tPosts = await obtenerPostsPorUid(user.uid).catch(()=>[]);
                const tShorts = await obtenerShortsPorUid(user.uid).catch(()=>[]);
                tPosts.forEach(v => allPosts.push({...v,id:v.id,contenido:v.texto||'',imagenPost:v.imagen_url||'',videoUrl:v.video_url||'',timestamp:Number(v.timestamp||0)}));
                tShorts.forEach(v => allShorts.push({...v,id:v.id,videoUrl:v.video_url||'',timestamp:Number(v.timestamp||0)}));
                allPosts.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
                allShorts.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
                animateCount(document.getElementById('stat-posts'),allPosts.length+allShorts.length);
                renderGrid('posts');
                
            } catch(e){  }
        });

        // ── Render grid/feed ──
        function renderGrid(tab) {
            activeTab=tab;
            const grid=document.getElementById('posts-grid'), feed=document.getElementById('feed-list');
            const info=document.getElementById('info-card'), wb=document.getElementById('wrapped-banner');
            const isTodo=tab==='posts';
            feed.style.display=isTodo?'flex':'none'; grid.style.display=!isTodo?'grid':'none';
            info.style.display=isTodo?'block':'none'; wb.style.display=isTodo?'block':'none';
            let list=tab==='posts'?allPosts:tab==='fotos'?allPosts.filter(p=>p.imagenPost&&!p.videoUrl):[...allPosts.filter(p=>p.videoUrl),...allShorts].sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
            if(isTodo){
                feed.innerHTML='';
                if(!list.length){feed.innerHTML='<div style="text-align:center;padding:48px 24px;color:var(--text-muted);"><i class="fa-solid fa-images" style="font-size:48px;opacity:0.3;display:block;margin-bottom:14px;"></i><p style="font-size:14px;">Aún no has publicado nada.</p></div>';return;}
                list.forEach(p=>feed.appendChild(buildPostCard(p)));
            } else {
                const icons={fotos:'fa-image',videos:'fa-circle-play'};
                const msgs={fotos:'No has publicado fotos.',videos:'No has publicado videos.'};
                if(!list.length){grid.innerHTML=`<div class="grid-empty"><i class="fa-solid ${icons[tab]||'fa-images'}"></i><p>${msgs[tab]||''}</p></div>`;return;}
                grid.innerHTML='';
                list.forEach((post,i)=>{
                    const item=document.createElement('div'); item.className='grid-item';
                    const isV=!!(post.videoUrl||post.isShort), isSh=!!post.descripcion&&!post.contenido;
                    if(isV) item.innerHTML=`<video src="${post.videoUrl}" muted preload="none" playsinline></video><span class="video-badge"><i class="fa-solid ${isSh?'fa-bolt':'fa-play'}"></i></span>`;
                    else if(post.imagenPost) item.innerHTML=`<img src="${post.imagenPost}" loading="lazy">`;
                    else { const w=(post.contenido||'').substring(0,60); item.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:10px;"><div style="font-size:10px;color:var(--text-muted);text-align:center;">${w}${w.length>=60?'…':''}</div></div>`; }
                    item.onclick=()=>{if(isV&&isSh)location.href='videos.html';};
                    grid.appendChild(item);
                });
            }
        }

        function buildPostCard(post) {
            const id=post.id, autor=post.autor||post.nombre||'Usuario', avatar=post.avatar||'default-avatar.png';
            const contenido=post.contenido||'', imgUrl=post.imagenPost||'', videoUrl=post.videoUrl||'', audioUrl=post.audioUrl||'';
            const ts=Number(post.timestamp||0), isVoz=post.esVoz||!!audioUrl;
            let media='';
            if(imgUrl) media=`<img class="post-img" src="${imgUrl}" loading="lazy" onclick="openImgFull('${imgUrl}')">`;
            else if(videoUrl) media=`<video class="post-video" src="${videoUrl}" controls playsinline></video>`;
            let extra='';
            if(post.humor) extra+=`<div class="post-mood"><i class="fa-solid fa-face-smile"></i> Se siente: ${post.humor}</div>`;
            if(post.esMomento&&post.tipoMomento) extra+=`<div class="post-tag"><i class="fa-solid fa-sun"></i> ${post.tipoMomento}</div>`;
            if(isVoz&&audioUrl){const dur=post.duracionAudio?`${Math.floor(post.duracionAudio/60)}:${String(post.duracionAudio%60).padStart(2,'0')}`:'–';extra+=`<div class="post-audio"><div class="audio-icon"><i class="fa-solid fa-microphone"></i></div><div class="audio-info">Nota de voz · ${dur}<br><audio controls src="${audioUrl}" style="width:100%;margin-top:6px;"></audio></div></div>`;}
            if(post.esEncuesta&&post.pregunta){
                let ops=post.opciones||[]; if(!Array.isArray(ops)) ops=Object.keys(ops).sort((a,b)=>Number(a)-Number(b)).map(k=>post.opciones[k]);
                ops=ops.filter(o=>o!=null).map(o=>typeof o==='string'?{texto:o}:o);
                const uid=currentUser?.uid, tot=ops.reduce((a,o)=>a+(o.votos?Object.keys(o.votos).length:0),0), myV=uid?ops.findIndex(o=>o.votos&&o.votos[uid]):-1;
                const opH=ops.map((o,i)=>{if(!o||!o.texto)return'';const v=o.votos?Object.keys(o.votos).length:0,pct=tot>0?Math.round(v/tot*100):0,yv=i===myV;return`<div class="encuesta-opcion" onclick="votarEncuesta('${id}',${i})"><div class="encuesta-bar" style="width:${pct}%"></div><span style="position:relative;font-weight:${yv?'700':'600'}">${o.texto}</span><span style="margin-left:auto;font-size:12px;position:relative">${pct}%</span>${yv?'<i class="fa-solid fa-check" style="margin-left:6px;font-size:11px;color:var(--accent);position:relative"></i>':''}</div>`;}).join('');
                if(opH) extra+=`<div class="post-encuesta"><div class="encuesta-pregunta-txt">${post.pregunta}</div>${opH}<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${tot} voto${tot!==1?'s':''}</div></div>`;
            }
            const big=contenido.length<100&&!imgUrl&&!videoUrl?' big':'';
            const likes=post.likes||{}, lc=Object.keys(likes).length, yl=currentUser&&likes[currentUser.uid];
            const card=document.createElement('div'); card.className='post-card'; card.dataset.id=id;
            card.innerHTML=`
                <div class="post-header">
                    <img class="post-avatar" src="${avatar}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=6c63ff&color=fff'">
                    <div class="post-meta"><div class="post-author">${autor}</div><div class="post-time">${timeAgo(ts)} <i class="fa-solid fa-earth-americas"></i></div></div>
                    <div class="post-menu" onclick="deleteMyPost('${id}')"><i class="fa-solid fa-ellipsis"></i></div>
                </div>
                ${(!post.esEncuesta&&contenido)?`<div class="post-content${big}">${contenido}</div>`:''}
                ${extra}${media}
                <div class="post-stats">
                    <div class="likes-count" id="lc-${id}">${lc>0?`<div class="like-bubble">👍</div> <span>${lc} Me gusta</span>`:''}</div>
                    <div class="comments-count" onclick="abrirComentarios('${id}')">Ver comentarios</div>
                </div>
                <div class="post-actions">
                    <div class="action-btn${yl?' liked':''}" id="lb-${id}" onclick="toggleLike('${id}')"><i class="${yl?'fa-solid':'fa-regular'} fa-thumbs-up"></i> Me gusta</div>
                    <div class="action-btn" onclick="abrirComentarios('${id}')"><i class="fa-regular fa-comment"></i> Comentar</div>
                    <div class="action-btn" onclick="shareMyPost('${id}')"><i class="fa-solid fa-share"></i> Compartir</div>
                </div>`;
            return card;
        }

        window.toggleLike=async function(id){
            if(!currentUser)return; const uid=currentUser.uid;
            const btn=document.getElementById(`lb-${id}`), lc=document.getElementById(`lc-${id}`);
            try{const s=await get(lr),post=allPosts.find(p=>p.id===id);if(!post)return;if(!post.likes)post.likes={};
                if(s.exists()){await remove(lr);delete post.likes[uid];if(btn){btn.classList.remove('liked');btn.innerHTML='<i class="fa-regular fa-thumbs-up"></i> Me gusta';}}
                else{await set(lr,true);post.likes[uid]=true;if(btn){btn.classList.add('liked');btn.innerHTML='<i class="fa-solid fa-thumbs-up"></i> Me gusta';}}
                const cnt=Object.keys(post.likes).length; if(lc)lc.innerHTML=cnt>0?`<div class="like-bubble">👍</div> <span>${cnt} Me gusta</span>`:'';
            }catch(e){}
        };

        window.votarEncuesta=async function(postId,idx){
            if(!currentUser)return; const uid=currentUser.uid;
            try{ await votarEnEncuesta(postId, currentUser.uid, idx); }catch(e){showToast('❌ Error');}
        };

        window.abrirComentarios=async function(postId){
            const sheet=document.createElement('div'); sheet.style.cssText='position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,0.5);';
            sheet.innerHTML=`<div style="background:var(--surface);border-radius:24px 24px 0 0;max-height:70vh;display:flex;flex-direction:column;font-family:inherit;"><div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;"><span style="font-size:16px;font-weight:800;">Comentarios</span><span onclick="this.closest('[style*=fixed]').remove()" style="cursor:pointer;font-size:20px;color:var(--text-muted);">✕</span></div><div id="cl-${postId}" style="overflow-y:auto;flex:1;padding:12px 16px;"></div><div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:10px;align-items:center;"><img src="${currentUser?.photoURL||''}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=6c63ff&color=fff'" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;"><input id="ci-${postId}" placeholder="Escribe un comentario..." style="flex:1;border:1px solid var(--border);border-radius:20px;padding:9px 16px;font-size:14px;font-family:inherit;background:var(--surface2);color:var(--text);outline:none;"><button onclick="enviarComentario('${postId}')" style="background:var(--accent);border:none;border-radius:50%;width:38px;height:38px;color:#fff;font-size:16px;cursor:pointer;flex-shrink:0;"><i class="fa-solid fa-paper-plane"></i></button></div></div>`;
            sheet.onclick=e=>{if(e.target===sheet)sheet.remove();}; document.body.appendChild(sheet);
            try{ const rows = await obtenerComentarios(postId, 100).catch(()=>[]); const el = document.getElementById(`cl-${postId}`); if(el) el.textContent = rows.length > 0 ? `${rows.length} comentario${rows.length!==1?'s':''}` : 'Ver comentarios'; }
                const cs=[]; s.forEach(c=>cs.push({id:c.key,...c.val()})); cs.sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
                el.innerHTML=cs.map(c=>`<div style="display:flex;gap:10px;margin-bottom:14px;"><img src="${c.avatar||''}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=6c63ff&color=fff'" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;"><div style="flex:1;"><div style="background:var(--surface2);border-radius:0 14px 14px 14px;padding:10px 14px;"><div style="font-size:13px;font-weight:700;margin-bottom:3px;">${c.autor||'Usuario'}</div><div style="font-size:14px;line-height:1.45;">${c.texto||''}</div></div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${timeAgo(c.timestamp||0)}</div></div></div>`).join('');
                el.scrollTop=el.scrollHeight;
            }catch(e){}
        };

        window.enviarComentario=async function(postId){
            if(!currentUser)return; const inp=document.getElementById(`ci-${postId}`), texto=inp?.value?.trim(); if(!texto)return; inp.value='';
            try{const usRows2 = await tursoQuery('SELECT nombre, avatar FROM usuarios WHERE uid = ?', [currentUser.uid]).catch(()=>[]);
const ud = usRows2[0] || {};
                
                const el=document.getElementById(`cl-${postId}`);
                if(el){const d=document.createElement('div');d.style.cssText='display:flex;gap:10px;margin-bottom:14px;';d.innerHTML=`<img src="${currentUser.photoURL||''}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=6c63ff&color=fff'" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;"><div style="flex:1;"><div style="background:var(--surface2);border-radius:0 14px 14px 14px;padding:10px 14px;"><div style="font-size:13px;font-weight:700;margin-bottom:3px;">${currentUser.displayName||'Usuario'}</div><div style="font-size:14px;">${texto}</div></div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Hace un momento</div></div>`;el.appendChild(d);el.scrollTop=el.scrollHeight;}
            }catch(e){}
        };

        window.deleteMyPost=function(id){
            const s=document.createElement('div');s.style.cssText='position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,0.4);';
            s.innerHTML=`<div style="background:var(--surface);border-radius:24px 24px 0 0;padding:20px 0 32px;font-family:inherit;"><div onclick="confirmDeletePost('${id}');this.closest('[style]').remove();" style="padding:16px 24px;font-size:16px;font-weight:700;color:#e74c3c;cursor:pointer;"><i class="fa-solid fa-trash" style="margin-right:10px;"></i>Eliminar publicación</div><div onclick="this.closest('[style]').remove();" style="padding:16px 24px;font-size:16px;font-weight:700;color:var(--text-muted);cursor:pointer;border-top:1px solid var(--border);">Cancelar</div></div>`;
            s.onclick=e=>{if(e.target===s)s.remove();}; document.body.appendChild(s);
        };
        window.confirmDeletePost=async function(id){
            try{}catch(e){}
            document.querySelector(`.post-card[data-id="${id}"]`)?.remove(); allPosts=allPosts.filter(p=>p.id!==id); showToast('🗑️ Eliminada');
        };
        window.shareMyPost=function(id){
            const url=`${location.origin}${location.pathname}?post=${id}`;
            if(navigator.share)navigator.share({url}); else{navigator.clipboard?.writeText(url);showToast('🔗 Link copiado');}
        };

        document.querySelectorAll('.ptab').forEach(t=>{t.onclick=()=>{document.querySelectorAll('.ptab').forEach(x=>x.classList.remove('active'));t.classList.add('active');renderGrid(t.dataset.tab);};});

        // ── Wrapped ──
        const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        const mes=new Date().getMonth(), anio=new Date().getFullYear();
        document.getElementById('wrapped-month-name').textContent=MESES[mes];
        document.getElementById('wlabel-0').textContent=`Tu ${MESES[mes]} en SnapBook`;
        function calcW(){const ini=new Date(anio,mes,1).getTime(),fin=new Date(anio,mes+1,0,23,59,59).getTime(),pm=allPosts.filter(p=>p.timestamp>=ini&&p.timestamp<=fin);return{total:pm.length,textos:pm.filter(p=>!p.imagenPost&&!p.videoUrl).length,fotos:pm.filter(p=>!!p.imagenPost).length,videos:pm.filter(p=>!!p.videoUrl).length,totalLikes:pm.reduce((a,p)=>a+Object.keys(p.likes||{}).length,0)};}
        window.openWrapped=function(){const s=calcW();document.getElementById('w-posts-count').textContent=s.total;document.getElementById('w-posts-sub').textContent=s.total===0?'Aún sin posts 👀':s.total>=10?'¡Increíble! 🔥':'¡Sigue así! 💪';document.getElementById('w-likes-count').textContent=s.totalLikes;document.getElementById('w-likes-sub').textContent=s.totalLikes===0?'Publica más 💡':s.totalLikes>=50?'¡Eres una estrella! ⭐':'¡Tu contenido gusta! ❤️';const tot=s.total||1,tp=Math.round(s.textos/tot*100),fp=Math.round(s.fotos/tot*100),vp=Math.round(s.videos/tot*100);document.getElementById('w-bar-text-pct').textContent=tp+'%';document.getElementById('w-bar-photo-pct').textContent=fp+'%';document.getElementById('w-bar-video-pct').textContent=vp+'%';setTimeout(()=>{document.getElementById('w-bar-text').style.width=tp+'%';document.getElementById('w-bar-photo').style.width=fp+'%';document.getElementById('w-bar-video').style.width=vp+'%';},400);document.getElementById('w-content-msg').textContent=`Este mes eres más ${fp>=vp&&fp>=tp?'📸 fotógrafa/o':vp>=tp?'🎥 creador/a':'✍️ escritor/a'}`;cSlide=0;buildDots();showSlide(0);document.getElementById('wrapped-modal').classList.add('open');};
        window.closeWrapped=()=>document.getElementById('wrapped-modal').classList.remove('open');
        let cSlide=0;
        function buildDots(){['','1','2','3'].forEach((s,i)=>{const el=document.getElementById('wrapped-dots'+(s?'-'+s:''));if(!el)return;el.innerHTML='';for(let j=0;j<4;j++){const d=document.createElement('div');d.className='wrapped-dot'+(j===i?' active':'');el.appendChild(d);}});}
        function showSlide(n){document.querySelectorAll('.wrapped-slide').forEach((s,i)=>s.classList.toggle('active',i===n));}
        window.nextSlide=()=>{cSlide=Math.min(cSlide+1,3);buildDots();showSlide(cSlide);};
        window.shareWrapped=function(){const s=calcW();const txt=`🎬 Mi Wrapped de ${MESES[mes]}:\n📝 ${s.total} posts\n❤️ ${s.totalLikes} likes\n¡Únete a SnapBook!`;if(navigator.share)navigator.share({title:'Mi Wrapped',text:txt});else navigator.clipboard.writeText(txt).then(()=>showToast('¡Copiado!'));};

        // ── Historial puntos ──
        window.abrirHistorialPuntos=async function(){
            const modal=document.getElementById('pts-modal'),body=document.getElementById('pts-body');
            modal.classList.add('open'); modal.onclick=e=>{if(e.target===modal)cerrarHistorialPuntos();};
            if(!currentUser)return; body.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-muted);">Cargando...</div>';
            try{const[pts,hist]=await Promise.all([obtenerPuntos(currentUser.uid),obtenerHistorial(currentUser.uid,30)]);const n=getNivel(pts);
                if(!hist.length){body.innerHTML=`<div style="text-align:center;padding:30px;"><div style="font-size:48px;">${n.icono}</div><div style="font-size:18px;font-weight:800;margin-top:8px;">Nivel ${n.nivel} · ${n.nombre}</div><div style="font-size:28px;font-weight:900;color:#f7b731;margin:8px 0;">${pts.toLocaleString()} ⭐</div><div style="font-size:13px;color:var(--text-muted);">Aún no hay actividad.</div></div>`;return;}
                const res=`<div style="background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:16px;padding:16px;margin-bottom:16px;text-align:center;"><div style="font-size:32px;">${n.icono}</div><div style="font-size:16px;font-weight:800;color:#fff;">Nivel ${n.nivel} · ${n.nombre}</div><div style="font-size:30px;font-weight:900;color:#fff;">${pts.toLocaleString()} ⭐</div></div><div style="font-size:13px;font-weight:800;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;">Últimas actividades</div>`;
                const its=hist.map(h=>{const df=Date.now()-h.ts,t=df<60000?'Ahora':df<3600000?`${Math.floor(df/60000)}m`:df<86400000?`${Math.floor(df/3600000)}h`:`${new Date(h.ts).getDate()}/${new Date(h.ts).getMonth()+1}`;return`<div class="pts-item"><div class="pts-item-label">${h.label||h.accion}<div class="pts-item-time">${t}</div></div><div class="pts-item-pts">+${h.pts} ⭐</div></div>`;}).join('');
                body.innerHTML=res+its;
            }catch(e){body.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-muted);">Error</div>';}
        };
        window.cerrarHistorialPuntos=()=>document.getElementById('pts-modal')?.classList.remove('open');

        // ── Upload avatar / cover ──
        document.getElementById('avatar-edit-btn').onclick=()=>document.getElementById('avatar-input').click();
        document.getElementById('avatar-input').onchange=async e=>{
            if(!currentUser||!e.target.files[0])return;
            try{const url=await uploadAvatar(currentUser.uid,e.target.files[0]);document.getElementById('profile-avatar').src=url;}
            catch(err){showToast('Error: '+err.message);}
        };
        // ── Avatares ──
        const AVATARES_COLECCIONES = [
            {
                nombre: 'Básicos', items: [
                    {id:'av_default',nombre:'Predeterminado',url:'https://ui-avatars.com/api/?name=U&background=6c63ff&color=fff&size=110',libre:true},
                    {id:'av_cool',nombre:'Cool Blue',url:'https://ui-avatars.com/api/?name=CB&background=1877f2&color=fff&size=110',libre:true},
                    {id:'av_rose',nombre:'Rosa',url:'https://ui-avatars.com/api/?name=RP&background=e91e8c&color=fff&size=110',libre:true},
                    {id:'av_green',nombre:'Verde',url:'https://ui-avatars.com/api/?name=GN&background=2ecc71&color=fff&size=110',libre:true},
                    {id:'av_orange',nombre:'Naranja',url:'https://ui-avatars.com/api/?name=OR&background=f39c12&color=fff&size=110',libre:true},
                    {id:'av_dark',nombre:'Oscuro',url:'https://ui-avatars.com/api/?name=DK&background=2c3e50&color=fff&size=110',libre:true},
                    {id:'av_red',nombre:'Rojo',url:'https://ui-avatars.com/api/?name=RD&background=e74c3c&color=fff&size=110',libre:true},
                    {id:'av_cyan',nombre:'Cyan',url:'https://ui-avatars.com/api/?name=CY&background=00bcd4&color=fff&size=110',libre:true},
                ]
            },
            {
                nombre: '⭐ Premium', items: [
                    {id:'av_alien',nombre:'Alien',emoji:'👽',libre:false,puntos:200},
                    {id:'av_robot',nombre:'Robot',emoji:'🤖',libre:false,puntos:300},
                    {id:'av_ninja',nombre:'Ninja',emoji:'🥷',libre:false,puntos:400},
                    {id:'av_wizard',nombre:'Mago',emoji:'🧙',libre:false,puntos:500},
                    {id:'av_devil',nombre:'Diablillo',emoji:'😈',libre:false,puntos:600},
                    {id:'av_angel',nombre:'Ángel',emoji:'😇',libre:false,puntos:700},
                    {id:'av_ghost',nombre:'Fantasma',emoji:'👻',libre:false,puntos:800},
                    {id:'av_cat',nombre:'Gatito',emoji:'🐱',libre:false,puntos:1000},
                    {id:'av_dragon',nombre:'Dragón',emoji:'🐲',libre:false,puntos:1500},
                    {id:'av_crown',nombre:'Rey/Reina',emoji:'👑',libre:false,puntos:2000},
                ]
            }
        ];

        let selectedAvatarId = null;

        window.abrirAvatares = function() {
            const modal = document.getElementById('avatares-modal');
            modal.style.display = 'flex';
            requestAnimationFrame(() => modal.classList.add('open'));
            modal.onclick = e => { if(e.target===modal) cerrarAvatares(); };
            renderAvatares();
        };
        window.cerrarAvatares = function() {
            const modal = document.getElementById('avatares-modal');
            modal.classList.remove('open');
            setTimeout(() => { modal.style.display = 'none'; }, 300);
        };

        function renderAvatares() {
            const body = document.getElementById('avatares-body');
            const owned = JSON.parse(localStorage.getItem('snapbook-avatares-owned')||'[]');
            const current = localStorage.getItem('snapbook-avatar-selected')||'av_default';
            selectedAvatarId = current;
            body.innerHTML = AVATARES_COLECCIONES.map(col => {
                const items = col.items.map(av => {
                    const isOwned = av.libre || owned.includes(av.id);
                    const isSel = av.id === selectedAvatarId;
                    const imgContent = av.url
                        ? `<img class="avatar-item-img" src="${av.url}" alt="${av.nombre}">`
                        : `<div class="avatar-item-img" style="display:flex;align-items:center;justify-content:center;font-size:32px;">${av.emoji||'👤'}</div>`;
                    const priceTag = !av.libre && !isOwned ? `<span class="avatar-item-lock">⭐ ${av.puntos}</span>` : (isOwned&&!av.libre?'<span style="font-size:10px;color:var(--accent);font-weight:700;">Desbloqueado</span>':'');
                    return `<div class="avatar-item${isSel?' selected':''}" onclick="selectAvatar('${av.id}',${av.libre},${isOwned})" data-avid="${av.id}">
                        ${imgContent}
                        <span class="avatar-item-name">${av.nombre}</span>
                        ${priceTag}
                    </div>`;
                }).join('');
                return `<div class="avatares-seccion-title">${col.nombre}</div><div class="avatares-grid">${items}</div>`;
            }).join('');
        }

        window.selectAvatar = function(id, libre, owned) {
            selectedAvatarId = id;
            document.querySelectorAll('.avatar-item').forEach(el => el.classList.toggle('selected', el.dataset.avid===id));
        };

        window.aplicarAvatar = async function() {
            if(!selectedAvatarId||!currentUser) return;
            const ownedList = JSON.parse(localStorage.getItem('snapbook-avatares-owned')||'[]');
            const allAvs = AVATARES_COLECCIONES.flatMap(c=>c.items);
            const av = allAvs.find(a=>a.id===selectedAvatarId);
            if(!av) return;
            if(!av.libre && !ownedList.includes(av.id)) { showToast('🔒 Desbloquea este avatar en la Tienda'); return; }
            const url = av.url || `https://ui-avatars.com/api/?name=${encodeURIComponent(av.emoji||av.nombre.charAt(0))}&background=6c63ff&color=fff&size=110`;
            try {
                await tursoQuery('UPDATE usuarios SET avatar = ? WHERE uid = ?', [url, currentUser.uid]).catch(()=>{});
                document.getElementById('profile-avatar').src = url;
                localStorage.setItem('snapbook-avatar-selected', selectedAvatarId);
                showToast('✅ Avatar actualizado');
                cerrarAvatares();
            } catch(e) { showToast('Error al guardar avatar'); }
        };

        // ── Tienda ──
        let tiendaTabActual = 'marcos';

        const TIENDA_TABS = {
            marcos: {
                titulo: '🖼️ Marcos de foto de perfil',
                items: [
                    {id:'marco_simple',nombre:'Marco Blanco',desc:'Limpio y elegante',color:'#ffffff',precio:0,tipo:'marco',libre:true},
                    {id:'marco_negro',nombre:'Marco Negro',desc:'Serio y elegante',color:'#222222',precio:100,tipo:'marco'},
                    {id:'marco_oro',nombre:'Marco Dorado',desc:'Brilla entre todos',color:'#f7b731',precio:300,tipo:'marco'},
                    {id:'marco_plata',nombre:'Marco Plata',desc:'Elegancia metálica',color:'#c0c0c0',precio:400,tipo:'marco'},
                    {id:'marco_morado',nombre:'Marco Morado',desc:'Realeza pura',color:'#6c63ff',precio:500,tipo:'marco'},
                    {id:'marco_rosa',nombre:'Marco Rosa',desc:'Vibras kawaii',color:'#ff6584',precio:500,tipo:'marco'},
                    {id:'marco_azul',nombre:'Marco Azul',desc:'Profundo como el mar',color:'#1877f2',precio:600,tipo:'marco'},
                    {id:'marco_verde',nombre:'Marco Verde',desc:'Naturaleza y frescura',color:'#2ecc71',precio:600,tipo:'marco'},
                    {id:'marco_fuego',nombre:'Marco Fuego',desc:'Tu perfil en llamas',color:'#e74c3c',precio:800,tipo:'marco'},
                    {id:'marco_galaxia',nombre:'Marco Galaxia',desc:'Del universo para ti',color:'#0a0a2a',precio:1200,tipo:'marco'},
                ]
            },
            efectos: {
                titulo: '✨ Efectos de marcos animados',
                items: [
                    {id:'efecto_glow',nombre:'Glow Suave',desc:'Brillo pulsante alrededor',anim:'pulse',color:'#6c63ff',precio:400,tipo:'efecto'},
                    {id:'efecto_glow_rosa',nombre:'Glow Rosa',desc:'Aura rosa brillante',anim:'pulse',color:'#ff6584',precio:400,tipo:'efecto'},
                    {id:'efecto_glow_oro',nombre:'Glow Dorado',desc:'Aura dorada exclusiva',anim:'pulse',color:'#f7b731',precio:600,tipo:'efecto'},
                    {id:'efecto_corazones',nombre:'Corazones',desc:'Amor en tu perfil ❤️',anim:'pulse',color:'#ff6584',precio:0,tipo:'efecto',libre:true},
                    {id:'efecto_estrellas',nombre:'Estrellas',desc:'Brilla como una estrella ⭐',anim:'pulse',color:'#f7b731',precio:0,tipo:'efecto',libre:true},
                    {id:'efecto_rainbow',nombre:'Arcoíris',desc:'Todos los colores girando',anim:'rainbow',color:'#f55',precio:800,tipo:'efecto'},
                    {id:'efecto_spin',nombre:'Giratorio',desc:'Marco que gira sin parar',anim:'spin',color:'#6c63ff',precio:1000,tipo:'efecto'},
                    {id:'efecto_neon_azul',nombre:'Neón Azul',desc:'Luz neón eléctrica',anim:'pulse',color:'#00bcd4',precio:1200,tipo:'efecto'},
                    {id:'efecto_neon_verde',nombre:'Neón Verde',desc:'Matrix energy',anim:'pulse',color:'#2ecc71',precio:1200,tipo:'efecto'},
                    {id:'efecto_fire',nombre:'Llamas',desc:'Marco en llamas 🔥',anim:'rainbow',color:'#e74c3c',precio:1500,tipo:'efecto'},
                ]
            },
            fondos: {
                items: [
                    {id:'fondo_corazones',nombre:'Corazones',desc:'Lluvia de amor ❤️',grad:'linear-gradient(135deg,#ff6584,#ff8fab)',precio:0,tipo:'fondo',libre:true,particles:['❤️','💕','💗']},
                    {id:'fondo_estrellas',nombre:'Estrellas',desc:'Cielo de destellos ⭐',grad:'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)',precio:0,tipo:'fondo',libre:true,particles:['⭐','✨','💫']},
                    {id:'fondo_flores',nombre:'Flores',desc:'Primavera en tu perfil 🌸',grad:'linear-gradient(135deg,#f9d4e8,#fce4ec,#f48fb1)',precio:0,tipo:'fondo',libre:true,particles:['🌸','🌺','🌼']},
                    {id:'fondo_nieve',nombre:'Nieve',desc:'Invierno mágico ❄️',grad:'linear-gradient(135deg,#e0f7fa,#b3e5fc,#81d4fa)',precio:0,tipo:'fondo',libre:true,particles:['❄️','🌨️','❅']},
                    {id:'fondo_floating',nombre:'Floating Particles',desc:'Partículas mágicas flotando 🔮',grad:'linear-gradient(135deg,#1a1a2e,#4a0080,#1a1a2e)',precio:0,tipo:'fondo',libre:true,particles:['🔮','✨','⚪','🌀','💜'],shimmer:true},
                    {id:'fondo_sunset',nombre:'Atardecer',desc:'Cálido degradado naranja',grad:'linear-gradient(135deg,#f7971e,#ffd200)',precio:500,tipo:'fondo',particles:['☀️','🌤️','✨'],shimmer:true},
                    {id:'fondo_ocean',nombre:'Océano',desc:'Azules profundos',grad:'linear-gradient(135deg,#1a6fe0,#00bcd4,#0a2a5e)',precio:600,tipo:'fondo',particles:['🌊','🐚','💧'],shimmer:true},
                    {id:'fondo_aurora',nombre:'Aurora',desc:'Luces del norte',grad:'linear-gradient(135deg,#43e97b,#38f9d7,#6c63ff)',precio:700,tipo:'fondo',particles:['🌌','✨','💫'],shimmer:true},
                    {id:'fondo_galaxy',nombre:'Galaxia',desc:'Universo infinito',grad:'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',precio:800,tipo:'fondo',particles:['🌟','⭐','🪐'],shimmer:true},
                    {id:'fondo_candy',nombre:'Candy',desc:'Dulce y colorido',grad:'linear-gradient(135deg,#ff6584,#f7b731,#6c63ff)',precio:900,tipo:'fondo',particles:['🍭','🍬','🎀'],shimmer:true},
                    {id:'fondo_fire',nombre:'Fuego',desc:'Ardiente y poderoso',grad:'linear-gradient(135deg,#f7971e,#f44336,#b71c1c)',precio:1000,tipo:'fondo',particles:['🔥','💥','✨'],shimmer:true},
                    {id:'fondo_forest',nombre:'Bosque',desc:'Verde natural',grad:'linear-gradient(135deg,#134e5e,#71b280,#2ecc71)',precio:1000,tipo:'fondo',particles:['🍃','🌿','🍀'],shimmer:true},
                    {id:'fondo_cyber',nombre:'Cyber',desc:'Futuro neón',grad:'linear-gradient(135deg,#0f0c29,#00bcd4,#6c63ff)',precio:1500,tipo:'fondo',particles:['⚡','🔷','💠'],shimmer:true},
                ]
            },
            particulas: {
                titulo: '🎇 Background Particles',
                items: [
                    {id:'bp_ninguna',  nombre:'Ninguna',      desc:'Sin partículas',                emojis:[],                precio:0,   tipo:'bgparticle',libre:true},
                    {id:'bp_corazones',nombre:'Amor',          desc:'Corazones flotando ❤️',          emojis:['❤️','💕','💗','💖'],precio:0,   tipo:'bgparticle',libre:true},
                    {id:'bp_estrellas',nombre:'Estrellas',     desc:'Destellos por toda la página ⭐', emojis:['⭐','✨','💫','🌟'],precio:0,   tipo:'bgparticle',libre:true},
                    {id:'bp_flores',   nombre:'Flores',        desc:'Primavera en tu perfil 🌸',       emojis:['🌸','🌺','🌼','🌷'],precio:0,   tipo:'bgparticle',libre:true},
                    {id:'bp_nieve',    nombre:'Nieve',         desc:'Copos cayendo ❄️',               emojis:['❄️','🌨️','⛄'],      precio:0,   tipo:'bgparticle',libre:true},
                    {id:'bp_confeti',  nombre:'Confeti',       desc:'Fiesta en tu perfil 🎉',          emojis:['🎉','🎊','🎈','🎀'],precio:300, tipo:'bgparticle'},
                    {id:'bp_mariposas',nombre:'Mariposas',     desc:'Mariposas mágicas 🦋',            emojis:['🦋','🌈','🌸'],      precio:400, tipo:'bgparticle'},
                    {id:'bp_dinero',   nombre:'Dinero',        desc:'Lluvia de billetes 💸',           emojis:['💸','💰','🤑','💵'],precio:500, tipo:'bgparticle'},
                    {id:'bp_fuego',    nombre:'Fuego',         desc:'Llamas por doquier 🔥',           emojis:['🔥','💥','✨'],      precio:600, tipo:'bgparticle'},
                    {id:'bp_galaxy',   nombre:'Galaxia',       desc:'Espacio profundo 🌌',             emojis:['🌌','🪐','🌟','☄️'], precio:700, tipo:'bgparticle'},
                    {id:'bp_musica',   nombre:'Música',        desc:'Notas musicales 🎵',              emojis:['🎵','🎶','🎸','🎤'],precio:500, tipo:'bgparticle'},
                    {id:'bp_comida',   nombre:'Comida',        desc:'Para los foodie 🍕',              emojis:['🍕','🍔','🌮','🍣'],precio:400, tipo:'bgparticle'},
                ]
            }
        };

        window.switchTiendaTab = function(tab, btn) {
            tiendaTabActual = tab;
            document.querySelectorAll('.tienda-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            renderTienda();
        };

        window.abrirTienda = function() {
            const modal = document.getElementById('tienda-modal');
            modal.style.display = 'flex';
            requestAnimationFrame(() => modal.classList.add('open'));
            modal.onclick = e => { if(e.target===modal) cerrarTienda(); };
            renderTienda();
            if(currentUser) {
                obtenerPuntos(currentUser.uid).then(pts => {
                    const el = document.getElementById('tienda-pts-display');
                    if(el) el.textContent = pts.toLocaleString();
                    renderTienda();
                }).catch(() => {});
            }
        };
        window.cerrarTienda = function() {
            const modal = document.getElementById('tienda-modal');
            modal.classList.remove('open');
            setTimeout(() => { modal.style.display = 'none'; }, 300);
        };

        function renderTienda() {
            const owned = JSON.parse(localStorage.getItem('snapbook-avatares-owned')||'[]');
            const ptsEl = document.getElementById('tienda-pts-display');
            const userPts = parseInt(ptsEl?.textContent?.replace(/[^0-9]/g,'')||'0');
            const body = document.getElementById('tienda-body');
            const tabData = TIENDA_TABS[tiendaTabActual];
            if(!tabData) return;

            const items = tabData.items.map(item => {
                const isOwned = item.libre || owned.includes(item.id);
                const canAfford = userPts >= item.precio;

                // Preview según tipo
                let preview = '';
                if(item.tipo === 'marco') {
                    preview = `<div style="width:64px;height:64px;border-radius:50%;border:5px solid ${item.color};display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:4px;background:var(--surface);">👤</div>`;
                } else if(item.tipo === 'efecto') {
                    const animClass = item.anim==='spin'?'anim-spin':item.anim==='rainbow'?'anim-rainbow':'anim-pulse';
                    const icon = item.id==='efecto_corazones'?'❤️':item.id==='efecto_estrellas'?'⭐':'👤';
                    preview = `<div style="width:64px;height:64px;border-radius:50%;border:5px solid ${item.color};display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:4px;background:var(--surface);color:${item.color};" class="${animClass}">${icon}</div>`;
                } else if(item.tipo === 'avatar') {
                    if(item.url) {
                        preview = `<img src="${item.url}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin-bottom:4px;border:2px solid var(--border);" onerror="this.style.display='none'">`;
                    } else {
                        preview = `<div style="width:64px;height:64px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:36px;margin-bottom:4px;">${item.emoji}</div>`;
                    }
                } else if(item.tipo === 'fondo') {
                    if(item.particles) {
                        const pts = item.particles.map((e,i) => {
                            const left = [10,35,60,80,20][i%5];
                            const dur  = [2.5,3,2,3.5,2.8][i%5];
                            const del  = [0,0.5,1,1.5,0.8][i%5];
                            return `<span class="fondo-particle" style="left:${left}%;--dur:${dur}s;--delay:${del}s;">${e}</span>`;
                        }).join('');
                        const shimmerLayer = item.shimmer ? `<div style="position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.2) 50%,transparent 60%);background-size:200% 100%;animation:cover-shimmer-anim 3s linear infinite;border-radius:12px;"></div>` : '';
                        preview = `<div class="fondo-preview-wrap"><div class="fondo-preview" style="background:${item.grad};"></div>${shimmerLayer}<div class="fondo-particles">${pts}</div></div>`;
                    } else {
                        preview = `<div class="fondo-preview" style="background:${item.grad};"></div>`;
                    }
                } else if(item.tipo === 'bgparticle') {
                    const activoId = localStorage.getItem('snapbook-item-activo-bgparticle') || 'bp_ninguna';
                    const isActive = item.id === activoId;
                    const emojisPreview = item.emojis.length
                        ? `<div style="font-size:22px;line-height:1.4;text-align:center;">${item.emojis.slice(0,4).join(' ')}</div>`
                        : `<div style="font-size:32px;">🚫</div>`;
                    preview = `<div style="width:100%;height:54px;border-radius:12px;background:var(--surface3);display:flex;align-items:center;justify-content:center;margin-bottom:4px;position:relative;overflow:hidden;${isActive?'border:2px solid var(--accent);':''}">${emojisPreview}${isActive?'<div style="position:absolute;top:4px;right:6px;font-size:10px;font-weight:800;color:var(--accent);">ON</div>':''}</div>`;
                }

                return `<div class="tienda-item${isOwned?' owned':(!canAfford?' cant-afford':'')}" onclick="comprarItem('${item.id}',${item.precio},'${item.tipo}','${item.libre||false}')">
                    ${isOwned?'<div class="tienda-item-owned-badge">Tuyo ✓</div>':''}
                    ${preview}
                    <div class="tienda-item-name">${item.nombre}</div>
                    <div class="tienda-item-desc">${item.desc}</div>
                    ${isOwned
                        ? '<div class="tienda-item-price" style="color:var(--accent);">✓ Obtenido</div>'
                        : item.precio===0
                            ? '<div class="tienda-item-price" style="color:#2ecc71;">Gratis</div>'
                            : `<div class="tienda-item-price"><i class="fa-solid fa-star" style="font-size:11px;"></i> ${item.precio} pts</div>`
                    }
                </div>`;
            }).join('');

            body.innerHTML = `<div class="tienda-cat-title">${tabData.titulo}</div><div class="tienda-items">${items}</div>`;
        }

        window.comprarItem = async function(id, precio, tipo, libre) {
            if(!currentUser) return;
            const owned = JSON.parse(localStorage.getItem('snapbook-avatares-owned')||'[]');
            // Item gratis — aplicar directamente
            if(libre==='true' || precio===0) {
                if(!owned.includes(id)) { owned.push(id); localStorage.setItem('snapbook-avatares-owned', JSON.stringify(owned)); }
                if(tipo==='marco'||tipo==='efecto'||tipo==='fondo'||tipo==='bgparticle') {
                    localStorage.setItem('snapbook-item-activo-'+tipo, id);
                    aplicarItemVisual(tipo, id);
                }
                showToast('✅ ¡Aplicado!');
                renderTienda();
                return;
            }
            if(owned.includes(id)) {
                // Ya comprado — solo aplicar
                if(tipo==='marco'||tipo==='efecto'||tipo==='fondo'||tipo==='bgparticle') {
                    localStorage.setItem('snapbook-item-activo-'+tipo, id);
                    aplicarItemVisual(tipo, id);
                    showToast('✅ ¡Aplicado!');
                    renderTienda();
                } else { showToast('✅ ¡Ya tienes este item!'); }
                return;
            }
            try {
                const pts = await obtenerPuntos(currentUser.uid);
                if(pts < precio) { showToast('⭐ No tienes suficientes puntos'); return; }
                const allItems = Object.values(TIENDA_TABS).flatMap(t=>t.items);
                const item = allItems.find(i=>i.id===id);
                const sheet = document.createElement('div');
                sheet.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,0.5);';
                const preview = item?.emoji ? `<div style="font-size:48px;margin-bottom:8px;">${item.emoji}</div>`
                    : item?.grad ? `<div style="width:80px;height:80px;border-radius:16px;background:${item.grad};margin:0 auto 12px;"></div>`
                    : item?.color ? `<div style="width:64px;height:64px;border-radius:50%;border:6px solid ${item.color};margin:0 auto 12px;"></div>`
                    : `<div style="font-size:48px;margin-bottom:8px;">🛍️</div>`;
                sheet.innerHTML=`<div style="background:var(--surface);border-radius:24px 24px 0 0;padding:24px 20px 32px;font-family:inherit;text-align:center;">
                    ${preview}
                    <div style="font-size:18px;font-weight:800;margin-bottom:4px;">${item?.nombre||id}</div>
                    <div style="font-size:14px;color:var(--text-muted);margin-bottom:16px;">¿Confirmas la compra por <strong style="color:#f7b731;">⭐ ${precio} pts</strong>?</div>
                    <div style="display:flex;gap:10px;">
                        <button onclick="this.closest('[style*=fixed]').remove()" style="flex:1;padding:13px;border-radius:14px;border:1px solid var(--border);background:var(--surface2);font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;color:var(--text);">Cancelar</button>
                        <button id="confirm-buy-btn" style="flex:1;padding:13px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;">Comprar</button>
                    </div>
                </div>`;
                sheet.onclick = e => { if(e.target===sheet) sheet.remove(); };
                document.body.appendChild(sheet);
                sheet.querySelector('#confirm-buy-btn').onclick = async () => {
                    sheet.remove();
                    try {
                        // puntos manejados por points.js
                        owned.push(id);
                        localStorage.setItem('snapbook-avatares-owned', JSON.stringify(owned));
                        document.getElementById('tienda-pts-display').textContent = (pts-precio).toLocaleString();
                        document.getElementById('nivel-pts-txt').textContent = (pts-precio).toLocaleString();
                        // Guardar item activo según tipo y aplicar visualmente
                        if(item) {
                            if(item.tipo==='marco'||item.tipo==='efecto'||item.tipo==='fondo'||item.tipo==='bgparticle') {
                                localStorage.setItem('snapbook-item-activo-'+item.tipo, id);
                                aplicarItemVisual(item.tipo, id);
                            }
                        }
                        showToast('🎉 ¡'+item?.nombre+' obtenido y aplicado!');
                        renderTienda();
                    } catch(err) { showToast('❌ Error al comprar'); }
                };
            } catch(e) { showToast('❌ Error'); }
        };

        // ── Mapeo de IDs tienda → avatar-frames.js ──
        // marco_* → frame_*, efecto_* → aura_* / fx_*
        const MARCO_TO_FRAME = {
            marco_simple: 'frame_none',
            marco_negro:  'frame_none',   // sin SVG especial, se maneja por color CSS
            marco_oro:    'frame_gold',
            marco_plata:  'frame_none',
            marco_morado: 'frame_gradient',
            marco_rosa:   'frame_gradient',
            marco_azul:   'frame_none',
            marco_verde:  'frame_none',
            marco_fuego:  'frame_fire',
            marco_galaxia:'frame_rainbow',
        };
        const EFECTO_TO_AURA = {
            efecto_glow:       { aura:'aura_purple',  fx:'fx_none'    },
            efecto_glow_rosa:  { aura:'aura_pink',    fx:'fx_none'    },
            efecto_glow_oro:   { aura:'aura_gold',    fx:'fx_none'    },
            efecto_rainbow:    { aura:'aura_rainbow', fx:'fx_none'    },
            efecto_spin:       { aura:'aura_cyan',    fx:'fx_none'    },
            efecto_neon_azul:  { aura:'aura_cyan',    fx:'fx_none'    },
            efecto_neon_verde: { aura:'aura_ice',     fx:'fx_none'    },
            efecto_fire:       { aura:'aura_fire',    fx:'fx_fire'    },
            efecto_corazones:  { aura:'aura_pink',    fx:'fx_hearts'  },
            efecto_estrellas:  { aura:'aura_gold',    fx:'fx_stars'   },
        };

        // Guarda el estado activo en Firebase para que avatar-frames.js lo lea
        async function syncAvatarShopToFirebase(marcoId, efectoId) {
            if (!currentUser) return;
            const frame  = MARCO_TO_FRAME[marcoId]  || 'frame_none';
            const efCfg  = EFECTO_TO_AURA[efectoId] || { aura:'aura_none', fx:'fx_none' };
            const shopData = {
                frame:  frame,
                aura:   efCfg.aura,
                fx:     efCfg.fx,
                filter: 'filter_none',
            };
            try {
                await tursoQuery('UPDATE usuarios SET avatar = ? WHERE uid = ?', [shopData.frameId||shopData, currentUser.uid]).catch(()=>{});
            } catch(e) { }
        }

        // ── Aplicar items visuales ──
        const MARCO_COLORES = {
            marco_simple:'#ffffff',marco_negro:'#222222',marco_oro:'#f7b731',marco_plata:'#c0c0c0',
            marco_morado:'#6c63ff',marco_rosa:'#ff6584',marco_azul:'#1877f2',marco_verde:'#2ecc71',
            marco_fuego:'#e74c3c',marco_galaxia:'#7c3aed'
        };
        const EFECTO_CONFIG = {
            efecto_glow:'pulse:#6c63ff', efecto_glow_rosa:'pulse:#ff6584', efecto_glow_oro:'pulse:#f7b731',
            efecto_rainbow:'rainbow:#f55', efecto_spin:'spin:#6c63ff', efecto_neon_azul:'pulse:#00bcd4',
            efecto_neon_verde:'pulse:#2ecc71', efecto_fire:'rainbow:#e74c3c',
            efecto_corazones:'pulse:#ff6584:❤️', efecto_estrellas:'pulse:#f7b731:⭐'
        };

        function aplicarItemVisual(tipo, id) {
            if(tipo === 'marco') {
                const marcoEl = document.getElementById('avatar-marco');
                const color = MARCO_COLORES[id] || '#6c63ff';
                marcoEl.style.setProperty('--marco-color', color);
                marcoEl.style.border = `5px solid ${color}`;
                marcoEl.classList.add('active');
            } else if(tipo === 'efecto') {
                const efectoEl = document.getElementById('avatar-efecto');
                const particlesEl = document.getElementById('avatar-particles');
                const cfg = EFECTO_CONFIG[id] || 'pulse:#6c63ff';
                const parts = cfg.split(':');
                const anim = parts[0], color = parts[1], emoji = parts[2]||null;
                efectoEl.className = 'avatar-efecto ' + anim;
                efectoEl.style.borderColor = color;
                efectoEl.style.boxShadow = `0 0 10px 3px ${color}55`;
                particlesEl.innerHTML = '';
                if(emoji) {
                    const positions = [{top:'5%',left:'10%',delay:'0s'},{top:'10%',left:'80%',delay:'0.5s'},{top:'75%',left:'5%',delay:'1s'},{top:'80%',left:'85%',delay:'1.5s'},{top:'50%',left:'95%',delay:'0.8s'}];
                    positions.forEach(p => {
                        const span = document.createElement('span');
                        span.className = 'particle';
                        span.textContent = emoji;
                        span.style.cssText = `top:${p.top};left:${p.left};animation-delay:${p.delay};animation-duration:2s;`;
                        particlesEl.appendChild(span);
                    });
                }
            } else if(tipo === 'fondo') {
                const allFondos = TIENDA_TABS.fondos.items;
                const fondo = allFondos.find(f => f.id === id);
                if(!fondo) return;
                const wrap = document.getElementById('cover-wrap');
                // Quitar imagen de portada si había
                const img = wrap.querySelector('img.cover-img');
                if(img) img.style.display = 'none';
                wrap.style.background = fondo.grad;
                wrap.style.backgroundSize = '200% 200%';
                wrap.style.animation = 'float-bg 6s ease infinite';
                // Limpiar capas previas
                wrap.querySelectorAll('.cover-particle-layer,.cover-shimmer').forEach(el => el.remove());
                // Shimmer
                if(fondo.shimmer) {
                    const shimmer = document.createElement('div');
                    shimmer.className = 'cover-shimmer';
                    wrap.appendChild(shimmer);
                }
                // Partículas
                if(fondo.particles && fondo.particles.length) {
                    const layer = document.createElement('div');
                    layer.className = 'cover-particle-layer';
                    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1;';
                    const emojis = fondo.particles;
                    const count = 12;
                    for(let i = 0; i < count; i++) {
                        const span = document.createElement('span');
                        const left = Math.round(Math.random() * 90 + 5);
                        const dur  = (2 + Math.random() * 2).toFixed(1);
                        const del  = (Math.random() * 3).toFixed(1);
                        const size = Math.round(14 + Math.random() * 10);
                        span.textContent = emojis[i % emojis.length];
                        const animName = id === 'fondo_floating' ? 'fondo-float-zigzag' : 'fondo-float';
                        span.style.cssText = `position:absolute;left:${left}%;bottom:0px;font-size:${size}px;animation:${animName} ${dur}s ease-in-out ${del}s infinite;`;
                        layer.appendChild(span);
                    }
                    wrap.appendChild(layer);
                }
            } else if(tipo === 'bgparticle') {
                const allParts = TIENDA_TABS.particulas.items;
                const item = allParts.find(p => p.id === id);
                if(!item) return;
                if(item.emojis.length === 0) {
                    stopBgParticles();
                } else {
                    startBgParticles(item.emojis);
                }
            }
            // Sincronizar con Firebase para que avatar-frames.js lo refleje en toda la app
            const marcoActivo  = tipo==='marco'  ? id : (localStorage.getItem('snapbook-item-activo-marco')||null);
            const efectoActivo = tipo==='efecto' ? id : (localStorage.getItem('snapbook-item-activo-efecto')||null);
            syncAvatarShopToFirebase(marcoActivo, efectoActivo);
        }

        function cargarItemsAplicados() {
            const marcoId     = localStorage.getItem('snapbook-item-activo-marco');
            const efectoId    = localStorage.getItem('snapbook-item-activo-efecto');
            const fondoId     = localStorage.getItem('snapbook-item-activo-fondo');
            const bgParticleId= localStorage.getItem('snapbook-item-activo-bgparticle');
            if(marcoId) aplicarItemVisual('marco', marcoId);
            if(efectoId) aplicarItemVisual('efecto', efectoId);
            if(fondoId) aplicarItemVisual('fondo', fondoId);
            if(bgParticleId && bgParticleId !== 'bp_ninguna') aplicarItemVisual('bgparticle', bgParticleId);
        }
        cargarItemsAplicados();

        document.getElementById('cover-edit-btn').onclick=()=>document.getElementById('cover-input').click();
        document.getElementById('cover-input').onchange=async e=>{
            if(!currentUser||!e.target.files[0])return;
            try{const url=await uploadCover(currentUser.uid,e.target.files[0]);const wrap=document.getElementById('cover-wrap');wrap.style.background='none';let img=wrap.querySelector('img.cover-img');if(!img){img=document.createElement('img');img.className='cover-img';wrap.prepend(img);}img.src=url;}
            catch(err){showToast('Error: '+err.message);}
        };

// ─────────────────────

// ── Background Particles ──────────────────────────────────────
const BG_EMOJIS_DEFAULT = ['❤️','💕','🌸','⭐','✨','🎉','🎊','💫','🌟','🦋','🍀','🎈','💜','🔮','🌈','💎','🌺','🎀'];
let _bgEmojis = BG_EMOJIS_DEFAULT;
let bgParticlesInterval = null;

function createBgParticle() {
    const layer = document.getElementById('bg-particles-layer');
    if(!layer) return;
    const span = document.createElement('span');
    span.className = 'bg-particle';
    span.textContent = _bgEmojis[Math.floor(Math.random() * _bgEmojis.length)];
    const left = Math.random() * 95;
    const dur  = (5 + Math.random() * 6).toFixed(1);
    const size = Math.round(16 + Math.random() * 18);
    span.style.cssText = `left:${left}%;bottom:0;font-size:${size}px;animation:bg-particle-float ${dur}s linear forwards;`;
    layer.appendChild(span);
    setTimeout(() => span.remove(), parseFloat(dur) * 1000 + 300);
}

function startBgParticles(emojis) {
    if(emojis) _bgEmojis = emojis;
    stopBgParticles();
    createBgParticle();
    bgParticlesInterval = setInterval(createBgParticle, 600);
}

function stopBgParticles() {
    if(bgParticlesInterval) { clearInterval(bgParticlesInterval); bgParticlesInterval = null; }
    const layer = document.getElementById('bg-particles-layer');
    if(layer) layer.innerHTML = '';
}