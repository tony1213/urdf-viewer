import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";

// ─── STL ─────────────────────────────────────────────────────
function parseSTLBin(buf){const dv=new DataView(buf),tri=dv.getUint32(80,true),v=new Float32Array(tri*9),n=new Float32Array(tri*9);let o=84;for(let i=0;i<tri;i++){const nx=dv.getFloat32(o,true);o+=4;const ny=dv.getFloat32(o,true);o+=4;const nz=dv.getFloat32(o,true);o+=4;for(let j=0;j<3;j++){const x=i*9+j*3;v[x]=dv.getFloat32(o,true);o+=4;v[x+1]=dv.getFloat32(o,true);o+=4;v[x+2]=dv.getFloat32(o,true);o+=4;n[x]=nx;n[x+1]=ny;n[x+2]=nz;}o+=2;}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(v,3));g.setAttribute("normal",new THREE.BufferAttribute(n,3));return g;}
function parseSTLAscii(t){const g=new THREE.BufferGeometry(),vs=[],ns=[];let m;const np=/facet\s+normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g,vp=/vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;while((m=np.exec(t)))for(let i=0;i<3;i++)ns.push(+m[1],+m[2],+m[3]);while((m=vp.exec(t)))vs.push(+m[1],+m[2],+m[3]);g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(vs),3));g.setAttribute("normal",new THREE.BufferAttribute(new Float32Array(ns),3));return g;}
function loadSTL(buf){try{const h=new TextDecoder().decode(buf.slice(0,80));if(h.startsWith("solid")&&!h.includes("\0")){const t=new TextDecoder().decode(buf);if(t.includes("facet"))return parseSTLAscii(t);}return parseSTLBin(buf);}catch{return parseSTLBin(buf);}}

// ─── OBJ ─────────────────────────────────────────────────────
function parseOBJ(text){const pos=[],nor=[],fv=[],fn=[];for(const line of text.split("\n")){const p=line.trim().split(/\s+/);if(p[0]==="v")pos.push([+p[1],+p[2],+p[3]]);else if(p[0]==="vn")nor.push([+p[1],+p[2],+p[3]]);else if(p[0]==="f"){const face=p.slice(1).map(s=>{const ids=s.split("/");return{v:+ids[0]-1,n:ids[2]?+ids[2]-1:-1};});for(let i=1;i<face.length-1;i++)for(const idx of[face[0],face[i],face[i+1]]){fv.push(...(pos[idx.v]||[0,0,0]));fn.push(...(idx.n>=0&&nor[idx.n]?nor[idx.n]:[0,0,1]));}}}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(fv),3));g.setAttribute("normal",new THREE.BufferAttribute(new Float32Array(fn),3));return g;}

// ─── DAE ─────────────────────────────────────────────────────
function parseDAE(text){const doc=new DOMParser().parseFromString(text,"text/xml"),group=new THREE.Group(),fas={};for(const el of doc.querySelectorAll("float_array")){const id=el.getAttribute("id");if(id)fas[id]=el.textContent.trim().split(/\s+/).map(Number);}const getSrc=sid=>{const s=doc.getElementById(sid.replace("#",""));if(!s)return null;const f=s.querySelector("float_array");if(!f)return null;return fas[f.getAttribute("id")]||f.textContent.trim().split(/\s+/).map(Number);};
  // Detect up_axis for vertex coordinate transform
  const upEl=doc.querySelector("up_axis");const isYup=upEl&&upEl.textContent.trim()==="Y_UP";
  for(const me of doc.querySelectorAll("geometry mesh")){const te=me.querySelector("triangles")||me.querySelector("polylist");if(!te)continue;let pd=null,nd=null;const offs={};let mo=0;for(const inp of te.querySelectorAll("input")){const sem=inp.getAttribute("semantic"),src=inp.getAttribute("source"),o=+(inp.getAttribute("offset")||"0");offs[sem]={source:src,offset:o};mo=Math.max(mo,o);if(sem==="VERTEX"){const ve=doc.querySelector(`[id="${src.replace("#","")}"]`);if(ve){const pi=ve.querySelector('input[semantic="POSITION"]');if(pi)pd=getSrc(pi.getAttribute("source"));}}else if(sem==="NORMAL")nd=getSrc(src);}if(!pd)continue;const pe=te.querySelector("p");if(!pe)continue;const ids=pe.textContent.trim().split(/\s+/).map(Number),st=mo+1,v=[],n=[];
  for(let i=0;i<ids.length;i+=st){const vi=ids[i+(offs.VERTEX?.offset||0)];
    let vx=pd[vi*3],vy=pd[vi*3+1],vz=pd[vi*3+2];
    if(isYup){const ty=vy;vy=-vz;vz=ty;} // Y_UP -> Z_UP: swap Y and Z, negate new Y
    v.push(vx,vy,vz);
    if(nd&&offs.NORMAL){const ni=ids[i+offs.NORMAL.offset];let nx=nd[ni*3],ny=nd[ni*3+1],nz=nd[ni*3+2];if(isYup){const tny=ny;ny=-nz;nz=tny;}n.push(nx,ny,nz);}}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(v),3));if(n.length)g.setAttribute("normal",new THREE.BufferAttribute(new Float32Array(n),3));else g.computeVertexNormals();group.add(new THREE.Mesh(g,new THREE.MeshPhysicalMaterial({color:0x999aab,metalness:0.3,roughness:0.5})));}return group;}

// ─── URDF Parser ─────────────────────────────────────────────
function parseURDF(xml){
  const doc=new DOMParser().parseFromString(xml,"text/xml"),re=doc.querySelector("robot");
  if(!re) throw new Error("未找到 <robot> 元素");
  const robotName=re.getAttribute("name")||"unnamed",links={},joints={},mats={};
  for(const m of re.querySelectorAll(":scope > material")){const nm=m.getAttribute("name"),ce=m.querySelector("color");if(nm&&ce){const rgba=ce.getAttribute("rgba");if(rgba){const p=rgba.split(/\s+/).map(Number);mats[nm]={r:p[0],g:p[1],b:p[2],a:p[3]??1};}}}
  const pO=el=>{if(!el)return{xyz:[0,0,0],rpy:[0,0,0]};return{xyz:(el.getAttribute("xyz")||"0 0 0").split(/\s+/).map(Number),rpy:(el.getAttribute("rpy")||"0 0 0").split(/\s+/).map(Number)};};
  for(const lEl of re.querySelectorAll(":scope > link")){
    const name=lEl.getAttribute("name"),visuals=[];
    // Parse both visual and collision geometries
    const parseGeomList=(selector)=>{
      const list=[];
      for(const v of lEl.querySelectorAll(selector)){const ge=v.querySelector("geometry");if(!ge)continue;const origin=pO(v.querySelector("origin"));let color=null;const ma=v.querySelector("material");if(ma){const cE=ma.querySelector("color");if(cE){const rgba=cE.getAttribute("rgba");if(rgba){const p=rgba.split(/\s+/).map(Number);color={r:p[0],g:p[1],b:p[2],a:p[3]??1};}}if(!color){const mn=ma.getAttribute("name");if(mn&&mats[mn])color=mats[mn];}}
      const bx=ge.querySelector("box"),cy=ge.querySelector("cylinder"),sp=ge.querySelector("sphere"),ms=ge.querySelector("mesh");
      if(bx)list.push({type:"box",size:bx.getAttribute("size").split(/\s+/).map(Number),origin,color});
      else if(cy)list.push({type:"cylinder",radius:+cy.getAttribute("radius"),length:+cy.getAttribute("length"),origin,color});
      else if(sp)list.push({type:"sphere",radius:+sp.getAttribute("radius"),origin,color});
      else if(ms){const sc=ms.getAttribute("scale");list.push({type:"mesh",filename:ms.getAttribute("filename"),scale:sc?sc.split(/\s+/).map(Number):[1,1,1],origin,color});}}
      return list;
    };
    const vis=parseGeomList("visual");
    const col=parseGeomList("collision");
    // Strategy: if visual uses DAE and collision has STL, prefer collision (DAE coords often don't match URDF frames)
    const visDae=vis.length>0&&vis.some(v=>v.type==="mesh"&&v.filename.toLowerCase().endsWith(".dae"));
    const colStl=col.length>0&&col.some(v=>v.type==="mesh"&&v.filename.toLowerCase().endsWith(".stl"));
    if(visDae&&colStl){
      // Use collision STL but carry over color from visual material
      const vcolor=vis[0]?.color;
      for(const c of col)if(!c.color&&vcolor)c.color=vcolor;
      visuals.push(...col);
    }else if(vis.length>0){
      visuals.push(...vis);
    }else{
      visuals.push(...col);
    }
    let inertial=null;const iEl=lEl.querySelector("inertial");
    if(iEl){const mass=+(iEl.querySelector("mass")?.getAttribute("value")||"0"),origin=pO(iEl.querySelector("origin")),ii=iEl.querySelector("inertia");let inertia=null;if(ii)inertia={ixx:+(ii.getAttribute("ixx")||0),ixy:+(ii.getAttribute("ixy")||0),ixz:+(ii.getAttribute("ixz")||0),iyy:+(ii.getAttribute("iyy")||0),iyz:+(ii.getAttribute("iyz")||0),izz:+(ii.getAttribute("izz")||0)};inertial={mass,origin,inertia};}
    links[name]={name,visuals,inertial};
  }
  for(const jEl of re.querySelectorAll(":scope > joint")){const name=jEl.getAttribute("name"),type=jEl.getAttribute("type"),parent=jEl.querySelector("parent")?.getAttribute("link"),child=jEl.querySelector("child")?.getAttribute("link"),origin=pO(jEl.querySelector("origin")),axEl=jEl.querySelector("axis"),limEl=jEl.querySelector("limit"),axis=axEl?axEl.getAttribute("xyz").split(/\s+/).map(Number):[0,0,1];let lower=-Math.PI,upper=Math.PI;if(limEl){lower=+(limEl.getAttribute("lower")||"-3.14159");upper=+(limEl.getAttribute("upper")||"3.14159");}if(type==="continuous"){lower=-Math.PI;upper=Math.PI;}joints[name]={name,type,parent,child,origin,axis,lower,upper};}
  return{name:robotName,links,joints};
}

// ─── RGB Axes Helper (XYZ = Red Green Blue) ──────────────────
function createRGBAxesHelper(scale=0.1){
  const group=new THREE.Group();group.userData.isJointAxis=true;
  const axes=[{dir:[1,0,0],color:0xff4444},{dir:[0,1,0],color:0x44ff44},{dir:[0,0,1],color:0x4488ff}];
  for(const{dir,color}of axes){
    const d=new THREE.Vector3(...dir);
    const shaftGeo=new THREE.CylinderGeometry(0.002,0.002,scale,6);
    const shaftMat=new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true,opacity:0.85});
    const shaft=new THREE.Mesh(shaftGeo,shaftMat);shaft.renderOrder=999;
    const coneGeo=new THREE.ConeGeometry(0.006,0.015,6);
    const cone=new THREE.Mesh(coneGeo,new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true,opacity:0.85}));
    cone.renderOrder=999;cone.position.y=scale/2;
    const inner=new THREE.Group();inner.add(shaft);inner.add(cone);
    const up=new THREE.Vector3(0,1,0);
    if(Math.abs(up.dot(d))<0.999){inner.quaternion.setFromUnitVectors(up,d);}else if(d.y<0){inner.rotation.z=Math.PI;}
    group.add(inner);
  }
  return group;
}

// ─── COM marker ──────────────────────────────────────────────
function createCOM(mass,origin){const g=new THREE.Group();g.userData.isCOM=true;const r=Math.max(0.008,Math.min(0.04,Math.cbrt(mass)*0.015));g.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(r,16,12),new THREE.MeshBasicMaterial({color:0xff4444,depthTest:false,transparent:true,opacity:0.75})),{renderOrder:998}));const lm=new THREE.LineBasicMaterial({color:0xff4444,depthTest:false,transparent:true,opacity:0.5});const s=r*2.5;for(const[a,b]of[[[s,0,0],[-s,0,0]],[[0,s,0],[0,-s,0]],[[0,0,s],[0,0,-s]]]){const lg=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a),new THREE.Vector3(...b)]);g.add(Object.assign(new THREE.Line(lg,lm),{renderOrder:998}));}g.position.set(...origin.xyz);const[r2,p,y]=origin.rpy;g.rotation.set(r2,p,y,"ZYX");return g;}

// ─── Inertia ellipsoid ───────────────────────────────────────
function createInertia(mass,inertia,origin){const g=new THREE.Group();g.userData.isInertia=true;if(!inertia||mass<=0)return g;const{ixx,iyy,izz}=inertia;const rx=Math.sqrt(Math.max(0.0001,5*(iyy+izz-ixx)/(4*mass))),ry=Math.sqrt(Math.max(0.0001,5*(ixx+izz-iyy)/(4*mass))),rz=Math.sqrt(Math.max(0.0001,5*(ixx+iyy-izz)/(4*mass)));const geo=new THREE.SphereGeometry(1,16,12);const mat=new THREE.MeshBasicMaterial({color:0x8844ff,wireframe:true,depthTest:false,transparent:true,opacity:0.4});const m=new THREE.Mesh(geo,mat);m.scale.set(Math.min(rx,0.5),Math.min(ry,0.5),Math.min(rz,0.5));m.renderOrder=997;g.add(m);g.position.set(...origin.xyz);const[r,p,y]=origin.rpy;g.rotation.set(r,p,y,"ZYX");return g;}

// ─── Build Scene ─────────────────────────────────────────────
async function buildRobotScene(robot,fileMap){
  const linkObjects={},jointObjects={},comMarkers=[],inertiaMarkers=[],axisHelpers=[];
  const resolve=fn=>fn.replace(/^package:\/\/[^/]*\//,"").replace(/^(model|file):\/\/[^/]*\//,"").replace(/^\.\//,"");
  const findFile=fn=>{const r=resolve(fn),rl=r.toLowerCase();for(const[p,d]of fileMap.entries()){const pl=p.toLowerCase();if(pl===rl||pl.endsWith("/"+rl))return d;}const bn=r.split("/").pop().toLowerCase();for(const[p,d]of fileMap.entries())if(p.toLowerCase().endsWith(bn))return d;return null;};
  const mkMat=c=>new THREE.MeshPhysicalMaterial({color:c?new THREE.Color(c.r,c.g,c.b):new THREE.Color(0.6,0.6,0.7),metalness:0.3,roughness:0.5,clearcoat:0.2,clearcoatRoughness:0.4,transparent:true,opacity:c?.a??1});
  const loadMesh=async vis=>{if(vis.type!=="mesh")return null;
    let file=findFile(vis.filename);
    let ext=vis.filename.split(".").pop().toLowerCase();
    // DAE files often have wrong scale/coordinate system in URDF contexts.
    // Try to find same-name STL as a more reliable alternative.
    if(ext==="dae"){
      const stlName=vis.filename.replace(/\.dae$/i,".stl");
      const stlFile=findFile(stlName);
      if(stlFile){file=stlFile;ext="stl";}
    }
    if(!file)return null;
    const mat=mkMat(vis.color);
    try{
      if(ext==="stl"){const g=loadSTL(await file.arrayBuffer());const m=new THREE.Mesh(g,mat);m.scale.set(...vis.scale);m.castShadow=m.receiveShadow=true;return m;}
      if(ext==="obj"){const g=parseOBJ(await file.text());const m=new THREE.Mesh(g,mat);m.scale.set(...vis.scale);m.castShadow=m.receiveShadow=true;return m;}
      if(ext==="dae"){const grp=parseDAE(await file.text());grp.scale.set(...vis.scale);if(vis.color)grp.traverse(c=>{if(c.isMesh){c.material=mat;c.castShadow=c.receiveShadow=true;}});return grp;}
    }catch(e){console.warn("Mesh err:",vis.filename,e);}return null;};
  const mkVis=async vis=>{if(vis.type==="mesh"){const ld=await loadMesh(vis);if(ld){if(vis.origin){ld.position.set(...vis.origin.xyz);const[r,p,y]=vis.origin.rpy;ld.rotation.set(r,p,y,"ZYX");}return ld;}}let geom;switch(vis.type){case"box":geom=new THREE.BoxGeometry(...vis.size);break;case"cylinder":geom=new THREE.CylinderGeometry(vis.radius,vis.radius,vis.length,24);break;case"sphere":geom=new THREE.SphereGeometry(vis.radius,24,16);break;default:geom=new THREE.BoxGeometry(0.03,0.03,0.03);}const m=new THREE.Mesh(geom,mkMat(vis.color));m.castShadow=m.receiveShadow=true;if(vis.origin){m.position.set(...vis.origin.xyz);const[r,p,y]=vis.origin.rpy;m.rotation.set(r,p,y,"ZYX");}return m;};

  const rootGroup=new THREE.Group();
  const childSet=new Set(Object.values(robot.joints).map(j=>j.child));
  const rootLink=Object.keys(robot.links).find(l=>!childSet.has(l));
  if(!rootLink) return{rootGroup,jointObjects,linkObjects,comMarkers,inertiaMarkers,axisHelpers};

  const build=async(linkName,parent)=>{
    const link=robot.links[linkName],lg=new THREE.Group();lg.name=linkName;
    for(const vis of(link.visuals||[])){const m=await mkVis(vis);if(m)lg.add(m);}
    if(link.inertial){const com=createCOM(link.inertial.mass,link.inertial.origin);com.visible=false;lg.add(com);comMarkers.push(com);if(link.inertial.inertia){const ie=createInertia(link.inertial.mass,link.inertial.inertia,link.inertial.origin);ie.visible=false;lg.add(ie);inertiaMarkers.push(ie);}}
    parent.add(lg);linkObjects[linkName]=lg;
    for(const joint of Object.values(robot.joints)){
      if(joint.parent===linkName){
        const jg=new THREE.Group();jg.name=joint.name;jg.position.set(...joint.origin.xyz);const[r,p,y]=joint.origin.rpy;
        const initEuler=new THREE.Euler(r,p,y,"ZYX");
        const initQuat=new THREE.Quaternion().setFromEuler(initEuler);
        jg.quaternion.copy(initQuat);
        jg.userData={jointType:joint.type,axis:new THREE.Vector3(...joint.axis),lower:joint.lower,upper:joint.upper,value:0,initQuat:initQuat.clone()};
        const ah=createRGBAxesHelper(0.1);ah.visible=false;jg.add(ah);axisHelpers.push(ah);
        lg.add(jg);jointObjects[joint.name]=jg;
        await build(joint.child,jg);
      }
    }
  };
  await build(rootLink,rootGroup);
  return{rootGroup,jointObjects,linkObjects,comMarkers,inertiaMarkers,axisHelpers};
}

// ─── Build URDF tree structure for display (hierarchical) ────
function buildURDFTree(robot){
  const childSet=new Set(Object.values(robot.joints).map(j=>j.child));
  const rootLink=Object.keys(robot.links).find(l=>!childSet.has(l));
  if(!rootLink) return null;
  const build=linkName=>{
    const node={type:"link",name:linkName,inertial:robot.links[linkName]?.inertial,children:[]};
    for(const j of Object.values(robot.joints)){
      if(j.parent===linkName){
        node.children.push({type:"joint",name:j.name,jointType:j.type,axis:j.axis,child:build(j.child)});
      }
    }
    return node;
  };
  return build(rootLink);
}

// ─── Build folder tree structure ─────────────────────────────
function buildFolderTree(files){
  const root={__files:[],__name:"root"};
  for(const f of files){
    const parts=f.split("/");let cur=root;
    for(let i=0;i<parts.length-1;i++){
      if(!cur[parts[i]])cur[parts[i]]={__files:[],__name:parts[i]};
      cur=cur[parts[i]];
    }
    cur.__files.push(parts[parts.length-1]);
  }
  return root;
}

// ─── Theme ───────────────────────────────────────────────────
const C_DARK={bg:"#0a0e17",panel:"#111827",border:"#1e293b",accent:"#22d3ee",accentDim:"#0e7490",text:"#e2e8f0",dim:"#64748b",danger:"#f43f5e"};
const C_LIGHT={bg:"#f0f4f8",panel:"#ffffff",border:"#d1d9e0",accent:"#0891b2",accentDim:"#0e7490",text:"#1e293b",dim:"#64748b",danger:"#f43f5e"};

// ─── FolderNode component ────────────────────────────────────
function FolderNode({node,name,depth=0,C=C_DARK}){
  const[open,setOpen]=useState(depth<2);
  const dirs=Object.keys(node).filter(k=>!k.startsWith("__"));
  const files=node.__files||[];
  const extIcon=f=>{const e=f.split(".").pop().toLowerCase();return e==="urdf"||e==="xacro"?"📄":e==="stl"?"🔷":e==="obj"?"🔶":e==="dae"?"🔻":"📎";};
  return(
    <div style={{paddingLeft:depth*12}}>
      {name!=="root"&&(
        <div onClick={()=>setOpen(!open)} style={{cursor:"pointer",padding:"2px 0",display:"flex",alignItems:"center",gap:4,color:C.text,fontSize:11}}>
          <span style={{fontSize:9,color:C.dim,width:10}}>{open?"▼":"▶"}</span>
          <span>📁</span><span style={{fontWeight:600}}>{name}</span>
          <span style={{color:C.dim,fontSize:10}}>({dirs.length+files.length})</span>
        </div>
      )}
      {(open||name==="root")&&(<>
        {dirs.map(d=><FolderNode key={d} node={node[d]} name={d} depth={depth+1} C={C}/>)}
        {files.map((f,i)=>(
          <div key={i} style={{paddingLeft:(depth+1)*12,padding:"1px 0",fontSize:11,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {extIcon(f)} {f}
          </div>
        ))}
      </>)}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export default function RobotViewer(){
  const canvasRef=useRef(null),sceneRef=useRef(null),cameraRef=useRef(null),rendererRef=useRef(null);
  const robotGroupRef=useRef(null),jointObjRef=useRef({}),linkObjRef=useRef({});
  const animRef=useRef(null),mouseDown=useRef(false),midDown=useRef(false),lastM=useRef({x:0,y:0});
  const camAngle=useRef({theta:Math.PI/4,phi:Math.PI/3,radius:2});
  const lookTarget=useRef(new THREE.Vector3(0,0.3,0));
  const comRef=useRef([]),inertiaRef=useRef([]),axisRef=useRef([]);
  const containerRef=useRef(null);

  const[robot,setRobot]=useState(null);
  const[jointVals,setJointVals]=useState({});
  const[dragging,setDragging]=useState(false);
  const[axes,setAxes]=useState(true);
  const[grid,setGrid]=useState(true);
  const[wire,setWire]=useState(false);
  const[error,setError]=useState(null);
  const[loading,setLoading]=useState(false);
  const[loadMsg,setLoadMsg]=useState("");
  const[files,setFiles]=useState([]);
  const[upAxis,setUpAxis]=useState("Z");
  const[upSign,setUpSign]=useState(1);
  const upAxisRef=useRef("Z");
  const upSignRef=useRef(1);
  useEffect(()=>{upAxisRef.current=upAxis;},[upAxis]);
  useEffect(()=>{upSignRef.current=upSign;},[upSign]);
  const[showCoordPanel,setShowCoordPanel]=useState(false);
  const[modelOffset,setModelOffset]=useState({x:0,y:0,z:0});
  const[showJointAxes,setShowJointAxes]=useState(false);
  const[axisScale,setAxisScale]=useState(0.1);
  const[showCOM,setShowCOM]=useState(false);
  const[showInertia,setShowInertia]=useState(false);
  // Per-link opacity: map of linkName -> opacity (0-1)
  const[linkOpacities,setLinkOpacities]=useState({});
  const[sidebarTab,setSidebarTab]=useState("joints"); // "joints"|"files"|"tree"
  const[sidebarWidth,setSidebarWidth]=useState(320);
  const[darkMode,setDarkMode]=useState(true);
  const[lang,setLang]=useState("zh"); // "zh"|"en"
  const[gridSize,setGridSize]=useState(1.0); // meters per grid cell, total size = gridSize * 10
  const resizingRef=useRef(false);
  const handleRef=useRef(null);

  const worldGroupRef=useRef(null),offsetGroupRef=useRef(null),folderRef=useRef(null);

  const updateCam=useCallback(()=>{if(!cameraRef.current)return;const{theta,phi,radius}=camAngle.current,t=lookTarget.current;cameraRef.current.position.set(t.x+radius*Math.sin(phi)*Math.cos(theta),t.y+radius*Math.cos(phi),t.z+radius*Math.sin(phi)*Math.sin(theta));cameraRef.current.lookAt(t);},[]);

  // Sidebar resize — native events + fullscreen overlay to prevent canvas from stealing mouse
  useEffect(()=>{
    const handle=handleRef.current,container=containerRef.current;
    if(!handle||!container)return;
    const onDown=e=>{
      e.preventDefault();e.stopPropagation();
      resizingRef.current=true;
      const overlay=document.createElement("div");
      overlay.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:col-resize;";
      document.body.appendChild(overlay);
      const onMove=ev=>{
        ev.preventDefault();
        const rect=container.getBoundingClientRect();
        const newW=Math.max(150,Math.min(600,rect.width-(ev.clientX-rect.left)-7));
        setSidebarWidth(newW);
      };
      const onUp=()=>{
        resizingRef.current=false;
        document.removeEventListener("mousemove",onMove);
        document.removeEventListener("mouseup",onUp);
        if(overlay.parentNode)overlay.parentNode.removeChild(overlay);
      };
      document.addEventListener("mousemove",onMove);
      document.addEventListener("mouseup",onUp);
    };
    handle.addEventListener("mousedown",onDown);
    return()=>handle.removeEventListener("mousedown",onDown);
  },[]);

  useEffect(()=>{
    const cv=canvasRef.current;if(!cv)return;
    const scene=new THREE.Scene();sceneRef.current=scene;
    const cam=new THREE.PerspectiveCamera(45,1,0.01,100);cameraRef.current=cam;updateCam();
    const ren=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});ren.setPixelRatio(Math.min(devicePixelRatio,2));ren.shadowMap.enabled=true;ren.shadowMap.type=THREE.PCFSoftShadowMap;ren.toneMapping=THREE.ACESFilmicToneMapping;ren.toneMappingExposure=1.2;rendererRef.current=ren;
    scene.add(new THREE.AmbientLight(0x334466,0.6));const dl=new THREE.DirectionalLight(0xffffff,1.2);dl.position.set(3,5,4);dl.castShadow=true;dl.shadow.mapSize.set(2048,2048);dl.shadow.camera.near=0.1;dl.shadow.camera.far=20;dl.shadow.camera.left=-3;dl.shadow.camera.right=3;dl.shadow.camera.top=3;dl.shadow.camera.bottom=-3;scene.add(dl);scene.add(new THREE.DirectionalLight(0x22d3ee,0.3).translateX(-2).translateY(3).translateZ(-2));scene.add(new THREE.HemisphereLight(0x22d3ee,0x0a0e17,0.4));
    const gnd=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshStandardMaterial({color:0x0d1117,roughness:0.9}));gnd.rotation.x=-Math.PI/2;gnd.receiveShadow=true;scene.add(gnd);
    const resize=()=>{const p=cv.parentElement;if(!p)return;ren.setSize(p.clientWidth,p.clientHeight);cam.aspect=p.clientWidth/p.clientHeight;cam.updateProjectionMatrix();};resize();window.addEventListener("resize",resize);
    const anim=()=>{animRef.current=requestAnimationFrame(anim);ren.render(scene,cam);};anim();
    return()=>{window.removeEventListener("resize",resize);cancelAnimationFrame(animRef.current);ren.dispose();};
  },[]);

  useEffect(()=>{const s=sceneRef.current;if(!s)return;s.children.filter(c=>c.userData.isHelper).forEach(c=>s.remove(c));if(grid){const gc=darkMode?[0x1a2332,0x131b2a]:[0xcccccc,0xdddddd];const totalSize=gridSize*10;const divisions=10;const g=new THREE.GridHelper(totalSize,divisions,gc[0],gc[1]);g.userData.isHelper=true;s.add(g);}if(axes){const a=new THREE.AxesHelper(0.5);a.userData.isHelper=true;s.add(a);}},[grid,axes,darkMode,gridSize]);

  // Update ground color on dark/light mode
  useEffect(()=>{
    const s=sceneRef.current;if(!s)return;
    s.traverse(c=>{
      if(c.isMesh&&c.geometry?.type==="PlaneGeometry"){
        c.material.color.set(darkMode?0x0d1117:0xf0f0f0);
        c.material.needsUpdate=true;
      }
    });
  },[darkMode]);

  // Re-fit canvas when sidebar width changes
  useEffect(()=>{
    const cv=canvasRef.current,ren=rendererRef.current,cam=cameraRef.current;
    if(!cv||!ren||!cam)return;
    requestAnimationFrame(()=>{
      const p=cv.parentElement;if(!p)return;
      ren.setSize(p.clientWidth,p.clientHeight);
      cam.aspect=p.clientWidth/p.clientHeight;
      cam.updateProjectionMatrix();
    });
  },[sidebarWidth]);

  const applyCoord=useCallback((ax,sign)=>{const wg=worldGroupRef.current;if(!wg)return;wg.rotation.set(0,0,0);if(ax==="Z"&&sign===1)wg.rotation.x=-Math.PI/2;else if(ax==="Z"&&sign===-1)wg.rotation.x=Math.PI/2;else if(ax==="Y"&&sign===1)wg.rotation.set(0,0,0);else if(ax==="Y"&&sign===-1)wg.rotation.x=Math.PI;else if(ax==="X"&&sign===1){wg.rotation.z=Math.PI/2;wg.rotation.x=-Math.PI/2;}else if(ax==="X"&&sign===-1){wg.rotation.z=-Math.PI/2;wg.rotation.x=-Math.PI/2;}},[]);
  useEffect(()=>{applyCoord(upAxis,upSign);},[upAxis,upSign,applyCoord]);
  useEffect(()=>{const og=offsetGroupRef.current;if(og)og.position.set(modelOffset.x,modelOffset.y,modelOffset.z);},[modelOffset]);
  const autoGround=useCallback(()=>{const og=offsetGroupRef.current;if(!og)return;og.position.set(0,0,0);og.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(og);if(box.isEmpty())return;setModelOffset(prev=>({...prev,y:-box.min.y}));},[]);

  useEffect(()=>{for(const ah of axisRef.current)ah.visible=showJointAxes;},[showJointAxes,robot]);
  useEffect(()=>{for(const ah of axisRef.current)ah.scale.setScalar(axisScale/0.1);},[axisScale,robot]);
  useEffect(()=>{for(const m of comRef.current)m.visible=showCOM;},[showCOM,robot]);
  useEffect(()=>{for(const m of inertiaRef.current)m.visible=showInertia;},[showInertia,robot]);

  // Per-link opacity effect
  useEffect(()=>{
    const lo=linkObjRef.current;
    for(const[linkName,group]of Object.entries(lo)){
      const opacity=linkOpacities[linkName]??1;
      group.traverse(c=>{
        if(c.isMesh&&c.material&&!c.renderOrder){
          c.material.transparent=true;c.material.opacity=opacity;c.material.needsUpdate=true;
        }
      });
    }
  },[linkOpacities]);

  useEffect(()=>{if(!robotGroupRef.current)return;robotGroupRef.current.traverse(c=>{if(c.isMesh&&c.material&&!c.renderOrder)c.material.wireframe=wire;});},[wire]);

  const loadURDF=useCallback(async(urdfStr,fileMap=new Map())=>{
    try{
      setError(null);setLoading(true);setLoadMsg("解析 URDF...");
      const parsed=parseURDF(urdfStr);let mc=0;for(const l of Object.values(parsed.links))for(const v of(l.visuals||[]))if(v.type==="mesh")mc++;
      setLoadMsg(`构建场景 · ${mc} 个 mesh...`);
      if(offsetGroupRef.current&&sceneRef.current)sceneRef.current.remove(offsetGroupRef.current);
      const{rootGroup,jointObjects,linkObjects,comMarkers,inertiaMarkers,axisHelpers}=await buildRobotScene(parsed,fileMap);
      robotGroupRef.current=rootGroup;jointObjRef.current=jointObjects;linkObjRef.current=linkObjects;
      comRef.current=comMarkers;inertiaRef.current=inertiaMarkers;axisRef.current=axisHelpers;
      const wg=new THREE.Group();wg.add(rootGroup);worldGroupRef.current=wg;
      const og=new THREE.Group();og.add(wg);offsetGroupRef.current=og;sceneRef.current.add(og);
      applyCoord(upAxisRef.current,upSignRef.current);
      og.updateMatrixWorld(true);const box0=new THREE.Box3().setFromObject(og);
      if(!box0.isEmpty()){og.position.set(0,-box0.min.y,0);setModelOffset({x:0,y:-box0.min.y,z:0});}else setModelOffset({x:0,y:0,z:0});
      og.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(og);
      if(!box.isEmpty()){const sz=box.getSize(new THREE.Vector3());camAngle.current.radius=Math.max(Math.max(sz.x,sz.y,sz.z)*2.5,0.8);lookTarget.current=box.getCenter(new THREE.Vector3());updateCam();}
      const iv={};for(const[n,o]of Object.entries(jointObjects))if(o.userData.jointType!=="fixed")iv[n]=0;
      // Init per-link opacities to 1
      const lo={};for(const ln of Object.keys(linkObjects))lo[ln]=1;
      setLinkOpacities(lo);
      setJointVals(iv);setRobot(parsed);setLoading(false);
    }catch(e){setError(e.message);setLoading(false);}
  },[updateCam,applyCoord]);

  const updateJoint=useCallback((name,val)=>{const o=jointObjRef.current[name];if(!o)return;const{axis,jointType,initQuat}=o.userData;o.userData.value=val;
    if(jointType==="revolute"||jointType==="continuous"){
      // Restore initial orientation, then apply joint rotation on top
      const jointRot=new THREE.Quaternion().setFromAxisAngle(axis,val);
      o.quaternion.copy(initQuat).multiply(jointRot);
    }else if(jointType==="prismatic"){if(!o.userData.op)o.userData.op=o.position.clone();o.position.copy(o.userData.op).addScaledVector(axis,val);}
    setJointVals(p=>({...p,[name]:val}));},[]);
  const resetJoints=useCallback(()=>{for(const n of Object.keys(jointObjRef.current))updateJoint(n,0);},[updateJoint]);

  // Native canvas mouse events — prevents browser autoscroll on middle button
  useEffect(()=>{
    const cv=canvasRef.current; if(!cv)return;
    const onDown=e=>{
      if(resizingRef.current)return;
      if(e.button===1){
        e.preventDefault(); // stop browser autoscroll
        midDown.current=true; lastM.current={x:e.clientX,y:e.clientY}; return;
      }
      if(e.button===0&&e.target.tagName!=="INPUT"){mouseDown.current=true;lastM.current={x:e.clientX,y:e.clientY};}
    };
    cv.addEventListener("mousedown",onDown);
    return()=>cv.removeEventListener("mousedown",onDown);
  },[]);

  const onMM=useCallback(e=>{
    if(resizingRef.current)return;
    const dx=e.clientX-lastM.current.x,dy=e.clientY-lastM.current.y;
    lastM.current={x:e.clientX,y:e.clientY};
    if(midDown.current){
      const cam=cameraRef.current;if(!cam)return;
      const right=new THREE.Vector3();const up=new THREE.Vector3();
      right.setFromMatrixColumn(cam.matrixWorld,0);
      up.setFromMatrixColumn(cam.matrixWorld,1);
      const panSpeed=0.002*camAngle.current.radius;
      lookTarget.current.addScaledVector(right,-dx*panSpeed);
      lookTarget.current.addScaledVector(up,dy*panSpeed);
      updateCam();return;
    }
    if(mouseDown.current){
      camAngle.current.theta-=dx*0.005;
      camAngle.current.phi=Math.max(0.1,Math.min(Math.PI-0.1,camAngle.current.phi+dy*0.005));
      updateCam();
    }
  },[updateCam]);
  const onMU=useCallback(e=>{if(e.button===1)midDown.current=false;else mouseDown.current=false;},[]);
  const onWh=useCallback(e=>{camAngle.current.radius=Math.max(0.2,Math.min(20,camAngle.current.radius+e.deltaY*0.003));updateCam();},[updateCam]);

  const processItems=useCallback(async dt=>{
    const fileMap=new Map(),arr=[];let urdf=null,urdfName="";const items=dt.items;
    if(items?.[0]?.webkitGetAsEntry){setLoadMsg("扫描文件夹...");const readEntry=entry=>new Promise(res=>{if(entry.isFile)entry.file(f=>{arr.push({path:entry.fullPath.replace(/^\//,""),file:f});res();},()=>res());else if(entry.isDirectory){const rd=entry.createReader();const readAll=(all=[])=>rd.readEntries(async ents=>{if(!ents.length){await Promise.all(all.map(readEntry));res();}else readAll([...all,...ents]);},()=>res());readAll();}else res();});const ents=[];for(let i=0;i<items.length;i++){const e=items[i].webkitGetAsEntry();if(e)ents.push(e);}await Promise.all(ents.map(readEntry));}else{for(let i=0;i<dt.files.length;i++){const f=dt.files[i];arr.push({path:f.webkitRelativePath||f.name,file:f});}}
    setFiles(arr.map(f=>f.path));setLoadMsg(`找到 ${arr.length} 个文件...`);
    for(const{path,file}of arr){const ext=path.split(".").pop().toLowerCase();if((ext==="urdf"||ext==="xacro")&&!urdf){urdf=await file.text();urdfName=path;}fileMap.set(path,file);const parts=path.split("/");if(parts.length>1)fileMap.set(parts.slice(1).join("/"),file);if(parts.length>2)fileMap.set(parts.slice(2).join("/"),file);}
    if(!urdf){for(const{path,file}of arr){if(path.endsWith(".xml")){const t=await file.text();if(t.includes("<robot")){urdf=t;urdfName=path;break;}}}}
    if(!urdf){setError("未在文件夹中找到 .urdf 文件");setLoading(false);return;}
    setLoadMsg(`加载 ${urdfName}...`);await loadURDF(urdf,fileMap);
  },[loadURDF]);
  const onDrop=useCallback(async e=>{e.preventDefault();setDragging(false);setLoading(true);setError(null);try{await processItems(e.dataTransfer);}catch(err){setError(err.message);setLoading(false);}},[processItems]);
  const onFolderSelect=useCallback(async e=>{const fls=e.target.files;if(!fls?.length)return;setLoading(true);setError(null);const fileMap=new Map(),arr=[];let urdf=null;for(let i=0;i<fls.length;i++){const f=fls[i],path=f.webkitRelativePath||f.name;arr.push({path,file:f});const ext=path.split(".").pop().toLowerCase();if((ext==="urdf"||ext==="xacro")&&!urdf){urdf=await f.text();}fileMap.set(path,f);const parts=path.split("/");if(parts.length>1)fileMap.set(parts.slice(1).join("/"),f);if(parts.length>2)fileMap.set(parts.slice(2).join("/"),f);}setFiles(arr.map(f=>f.path));if(!urdf){for(const{path,file}of arr){if(path.endsWith(".xml")){const t=await file.text();if(t.includes("<robot")){urdf=t;break;}}}}if(!urdf){setError("未在文件夹中找到 .urdf 文件");setLoading(false);return;}await loadURDF(urdf,fileMap);},[loadURDF]);

  const jEntries=Object.entries(jointVals).filter(([n])=>{const o=jointObjRef.current[n];return o&&o.userData.jointType!=="fixed";});
  const hasInertial=robot?Object.values(robot.links).some(l=>l.inertial):false;
  const linkNames=robot?Object.keys(robot.links):[];
  const urdfTree=robot?buildURDFTree(robot):null;
  const folderTree=files.length?buildFolderTree(files):null;

  const C=darkMode?C_DARK:C_LIGHT;

  const T=lang==="zh"?{
    jointCtrl:"关节控制",jointOpacity:"关节透明度",folder:"文件",noJoints:"没有可控关节",
    showAll:"全部显示",halfTrans:"全部半透",hideAll:"全部隐藏",resetJoints:"↺ 重置关节",unload:"✕ 卸载模型",
    dragFolder:"拖放 URDF 文件夹",supportMesh:"支持 STL / OBJ / DAE mesh",selectFolder:"📂 选择文件夹",
    dropRelease:"释放以加载 URDF 文件夹",loading:"加载中...",scanFolder:"扫描文件夹...",
    foundFiles:n=>`找到 ${n} 个文件...`,loadFile:n=>`加载 ${n}...`,buildScene:n=>`构建场景 · ${n} 个 mesh...`,
    noUrdf:"未在文件夹中找到 .urdf 文件",parseUrdf:"解析 URDF...",
    grid:"网格",coordAxes:"坐标轴",wireframe:"线框",toggleBg:"切换背景",
    jointAxes:"关节坐标系 (RGB)",com:"质心 (COM)",inertia:"转动惯量",axisSize:"尺寸",
    coordSys:"坐标系 (Up Axis)",heightOffset:"模型高度偏移",autoGround:"⬇ 自动落地",viewPresets:"视角预设",
    front:"前",back:"后",left:"左",right:"右",top:"上",persp:"透视",
    urdfTree:"🔗 URDF 树",folderTree:"📁 文件夹",noFolderData:"无文件夹数据",
    loadedFiles:"已加载文件",gridSizeLabel:"网格大小",
  }:{
    jointCtrl:"Joints",jointOpacity:"Opacity",folder:"Files",noJoints:"No controllable joints",
    showAll:"Show All",halfTrans:"Semi-Trans",hideAll:"Hide All",resetJoints:"↺ Reset Joints",unload:"✕ Unload",
    dragFolder:"Drop URDF Folder",supportMesh:"Supports STL / OBJ / DAE mesh",selectFolder:"📂 Select Folder",
    dropRelease:"Drop to load URDF folder",loading:"Loading...",scanFolder:"Scanning folder...",
    foundFiles:n=>`Found ${n} files...`,loadFile:n=>`Loading ${n}...`,buildScene:n=>`Building scene · ${n} meshes...`,
    noUrdf:"No .urdf file found in folder",parseUrdf:"Parsing URDF...",
    grid:"Grid",coordAxes:"Axes",wireframe:"Wireframe",toggleBg:"Toggle BG",
    jointAxes:"Joint Axes (RGB)",com:"COM",inertia:"Inertia",axisSize:"Size",
    coordSys:"Coord System (Up Axis)",heightOffset:"Model Height Offset",autoGround:"⬇ Auto Ground",viewPresets:"View Presets",
    front:"Front",back:"Back",left:"Left",right:"Right",top:"Top",persp:"Persp",
    urdfTree:"🔗 URDF Tree",folderTree:"📁 Folder",noFolderData:"No folder data",
    loadedFiles:"Loaded Files",gridSizeLabel:"Grid Size",
  };

  const TBtn=({active,onClick,children,title,color})=>(
    <button className="tb" title={title} onClick={onClick} style={{width:36,height:36,borderRadius:8,background:active?(color||C.accent):C.panel,border:`1px solid ${active?(color||C.accent):C.border}`,color:active?C.bg:C.dim,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:14,transition:"all 0.15s",padding:0}}>{children}</button>
  );

  // Tab button
  const TabBtn=({id,label})=>(
    <button onClick={()=>setSidebarTab(id)} style={{flex:1,padding:"6px 0",fontSize:11,fontWeight:sidebarTab===id?700:500,color:sidebarTab===id?C.accent:C.dim,background:sidebarTab===id?`${C.accent}15`:"transparent",border:"none",borderBottom:sidebarTab===id?`2px solid ${C.accent}`:`2px solid transparent`,cursor:"pointer",transition:"all 0.15s",fontFamily:"inherit"}}>{label}</button>
  );

  return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",background:C.bg,display:"flex",fontFamily:"'JetBrains Mono','Fira Code',monospace",color:C.text,overflow:"hidden",position:"relative"}}
      onDrop={onDrop} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(e.currentTarget===e.target)setDragging(false);}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
        input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:${C.accent};cursor:pointer;box-shadow:0 0 8px ${C.accent}66;border:2px solid ${C.bg};}
        input[type="range"]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:${C.accent};cursor:pointer;box-shadow:0 0 8px ${C.accent}66;border:2px solid ${C.bg};}
        .ji:hover{background:${C.border}44;} .tb:hover{background:${C.border};color:${C.text};}
        ::-webkit-scrollbar{width:6px;} ::-webkit-scrollbar-track{background:transparent;} ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px;}
        @keyframes spin{to{transform:rotate(360deg);}} .fb:hover{opacity:0.88;transform:translateY(-1px);} .rb:hover{background:${C.danger}33!important;} .cb:hover{border-color:${C.accent}!important;color:${C.text}!important;background:${C.border}44!important;}
        .lk-row:hover{background:${C.border}33;}
      `}</style>
      <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple style={{display:"none"}} onChange={onFolderSelect}/>

      {/* Canvas */}
      <div style={{flex:1,position:"relative",minWidth:0}}>
        <canvas ref={canvasRef} style={{width:"100%",height:"100%",cursor:"grab",background:darkMode?"#0a0e17":"#f0f4f8"}} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={e=>{mouseDown.current=false;midDown.current=false;}} onWheel={onWh} onContextMenu={e=>e.preventDefault()} onAuxClick={e=>e.preventDefault()}/>

        {/* Left toolbar */}
        <div style={{position:"absolute",top:16,left:16,display:"flex",flexDirection:"column",gap:6,zIndex:20}}>
          <TBtn active={grid} onClick={()=>setGrid(!grid)} title={T.grid}>⊞</TBtn>
          {grid&&(
            <div style={{background:`${C.panel}ee`,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px",width:36,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <input type="range" min={0.1} max={5} step={0.1} value={gridSize} onChange={e=>setGridSize(+e.target.value)}
                style={{width:60,transform:"rotate(-90deg)",transformOrigin:"center",margin:"18px 0",appearance:"none",WebkitAppearance:"none",height:3,borderRadius:2,background:C.border,outline:"none",cursor:"pointer"}}/>
              <div style={{fontSize:8,color:C.dim}}>{gridSize.toFixed(1)}m</div>
            </div>
          )}
          <TBtn active={axes} onClick={()=>setAxes(!axes)} title={T.coordAxes}>✛</TBtn>
          <TBtn active={wire} onClick={()=>setWire(!wire)} title={T.wireframe}>△</TBtn>
          <TBtn active={!darkMode} onClick={()=>setDarkMode(!darkMode)} title={T.toggleBg} color={darkMode?C.accent:"#334155"}>
            {darkMode?"☀":"🌙"}
          </TBtn>
          <div style={{height:1,background:C.border,margin:"2px 0"}}/>
          <TBtn active={showJointAxes} onClick={()=>setShowJointAxes(!showJointAxes)} title={T.jointAxes} color="#ffaa00">
            <svg width="18" height="18" viewBox="0 0 18 18">
              <line x1="4" y1="14" x2="16" y2="14" stroke="#ff4444" strokeWidth="2" strokeLinecap="round"/>
              <line x1="4" y1="14" x2="4" y2="2" stroke="#44ff44" strokeWidth="2" strokeLinecap="round"/>
              <line x1="4" y1="14" x2="1" y2="17" stroke="#4488ff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </TBtn>
          <TBtn active={showCOM} onClick={()=>setShowCOM(!showCOM)} title={T.com} color="#ff4444">
            <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><line x1="9" y1="2" x2="9" y2="5" stroke="currentColor" strokeWidth="1"/><line x1="9" y1="13" x2="9" y2="16" stroke="currentColor" strokeWidth="1"/><line x1="2" y1="9" x2="5" y2="9" stroke="currentColor" strokeWidth="1"/><line x1="13" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="1"/></svg>
          </TBtn>
          {hasInertial&&<TBtn active={showInertia} onClick={()=>setShowInertia(!showInertia)} title={T.inertia} color="#8844ff">
            <svg width="18" height="18" viewBox="0 0 18 18"><ellipse cx="9" cy="9" rx="7" ry="4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2,1.5"/><ellipse cx="9" cy="9" rx="4" ry="7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2,1.5"/></svg>
          </TBtn>}
          {showJointAxes&&(
            <div style={{background:`${C.panel}ee`,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 6px",width:36,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div style={{fontSize:8,color:"#ffaa00",fontWeight:700}}>{T.axisSize}</div>
              <input type="range" min={0.02} max={0.5} step={0.01} value={axisScale} onChange={e=>setAxisScale(+e.target.value)}
                style={{width:60,transform:"rotate(-90deg)",transformOrigin:"center",margin:"20px 0",appearance:"none",WebkitAppearance:"none",height:3,borderRadius:2,background:C.border,outline:"none",cursor:"pointer"}}/>
              <div style={{fontSize:8,color:C.dim}}>{axisScale.toFixed(2)}</div>
            </div>
          )}
        </div>

        {/* Coord gizmo (top right of canvas) */}
        <div style={{position:"absolute",top:16,right:16,zIndex:20,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
          <div style={{position:"relative"}}>
            <button className="tb" onClick={()=>{try{setShowCoordPanel(v=>!v);}catch(e){console.error(e);}}} style={{width:44,height:44,borderRadius:10,background:showCoordPanel?C.accent:C.panel,border:`1px solid ${showCoordPanel?C.accent:C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s",padding:0}}>
              <svg width="28" height="28" viewBox="0 0 28 28"><line x1="14" y1="14" x2="26" y2="18" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round"/><line x1="14" y1="14" x2="14" y2="2" stroke="#34d399" strokeWidth="2" strokeLinecap="round"/><line x1="14" y1="14" x2="4" y2="20" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/><circle cx="14" cy="14" r="2" fill={showCoordPanel?C.bg:C.text}/></svg>
            </button>
            <div style={{position:"absolute",top:0,right:0,fontSize:9,fontWeight:700,color:C.accent,background:`${C.accent}22`,borderRadius:4,padding:"1px 3px",pointerEvents:"none",transform:"translate(4px,-4px)"}}>{upSign>0?"+":"-"}{upAxis}</div>
          </div>
          {showCoordPanel&&(
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:16,minWidth:240,boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
              <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.08em"}}>{T.coordSys}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                {[{l:"+Z",a:"Z",s:1,c:"#60a5fa"},{l:"-Z",a:"Z",s:-1,c:"#60a5fa"},{l:"+Y",a:"Y",s:1,c:"#34d399"},{l:"-Y",a:"Y",s:-1,c:"#34d399"},{l:"+X",a:"X",s:1,c:"#f43f5e"},{l:"-X",a:"X",s:-1,c:"#f43f5e"}].map(item=>{
                  const act=upAxis===item.a&&upSign===item.s;
                  return <button key={item.l} className="cb" onClick={()=>{setUpAxis(item.a);setUpSign(item.s);}} style={{padding:"7px 4px",borderRadius:6,border:`1.5px solid ${act?item.c:C.border}`,background:act?item.c+"22":C.bg,color:act?item.c:C.dim,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>{item.l}</button>;
                })}
              </div>
              <div style={{fontSize:11,fontWeight:700,color:C.text,marginTop:8,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"}}>{T.heightOffset}</div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <input type="range" min={-2} max={2} step={0.001} value={modelOffset.y||0} onChange={e=>setModelOffset(prev=>({...prev,y:+e.target.value}))} style={{flex:1,appearance:"none",WebkitAppearance:"none",height:4,borderRadius:2,background:C.border,outline:"none",cursor:"pointer"}}/>
                <span style={{fontSize:11,color:C.accent,fontVariantNumeric:"tabular-nums",minWidth:50,textAlign:"right"}}>{(modelOffset.y||0).toFixed(3)}</span>
              </div>
              <button className="cb" onClick={autoGround} style={{width:"100%",padding:"6px",borderRadius:6,border:`1px solid ${C.accent}44`,background:`${C.accent}11`,color:C.accent,fontSize:11,fontWeight:600,cursor:"pointer",marginBottom:8}}>{T.autoGround}</button>
              <div style={{fontSize:11,fontWeight:700,color:C.text,marginTop:4,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"}}>{T.viewPresets}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                {[{l:T.front,th:Math.PI/2,ph:Math.PI/2},{l:T.back,th:-Math.PI/2,ph:Math.PI/2},{l:T.left,th:Math.PI,ph:Math.PI/2},{l:T.right,th:0,ph:Math.PI/2},{l:T.top,th:Math.PI/4,ph:0.15},{l:T.persp,th:Math.PI/4,ph:Math.PI/3}].map(item=>(
                  <button key={item.l} className="cb" onClick={()=>{camAngle.current.theta=item.th;camAngle.current.phi=item.ph;updateCam();}} style={{padding:"5px 4px",borderRadius:6,border:`1px solid ${C.border}`,background:C.bg,color:C.dim,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>{item.l}</button>
                ))}
              </div>
              {/* Grid size */}
              <div style={{fontSize:11,fontWeight:700,color:C.text,marginTop:10,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"}}>{T.gridSizeLabel}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input type="range" min={0.1} max={5} step={0.1} value={gridSize} onChange={e=>setGridSize(+e.target.value)} style={{flex:1,appearance:"none",WebkitAppearance:"none",height:4,borderRadius:2,background:C.border,outline:"none",cursor:"pointer"}}/>
                <span style={{fontSize:11,color:C.accent,fontVariantNumeric:"tabular-nums",minWidth:40,textAlign:"right"}}>{gridSize.toFixed(1)}m</span>
              </div>
            </div>
          )}
        </div>

        {/* Info */}
        {robot&&(<div style={{position:"absolute",bottom:16,left:16,padding:"8px 14px",background:`${C.panel}ee`,borderRadius:8,border:`1px solid ${C.border}`,fontSize:11,color:C.dim,zIndex:20,display:"flex",gap:16,alignItems:"center"}}><span><span style={{color:C.accent}}>●</span> {robot.name}</span><span>{linkNames.length} links</span><span>{jEntries.length} joints</span><span style={{color:C.accent}}>Up:{upSign>0?"+":"-"}{upAxis}</span></div>)}
        {loading&&(<div style={{position:"absolute",inset:0,background:"rgba(10,14,23,0.85)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:50,gap:16}}><div style={{width:48,height:48,border:`3px solid ${C.border}`,borderTopColor:C.accent,borderRadius:"50%",animation:"spin 1s linear infinite"}}/><div style={{fontSize:14,color:C.text,fontWeight:600}}>{loadMsg||T.loading}</div></div>)}
      </div>

      {/* ─── Resize Handle ─── */}
      <div ref={handleRef}
        style={{width:14,cursor:"col-resize",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:20}}>
        <div style={{width:4,height:60,background:`${C.accent}66`,borderRadius:4}}/>
      </div>

      {/* ─── Sidebar ─── */}
      <div style={{width:sidebarWidth,flexShrink:0,background:C.panel,display:"flex",flexDirection:"column",overflow:"hidden",zIndex:10}}>
        <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",background:`linear-gradient(135deg,${C.accent},${C.accentDim})`,fontSize:15}}>🤖</div>
          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:C.accent}}>Robot Viewer</div></div>
          <button onClick={()=>setLang(lang==="zh"?"en":"zh")} style={{padding:"3px 8px",borderRadius:5,border:`1px solid ${C.border}`,background:C.bg,color:C.dim,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
            {lang==="zh"?"EN":"中"}
          </button>
        </div>

        {!robot?(
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,gap:16}}>
            <div style={{fontSize:52,opacity:0.25}}>📁</div>
            <div style={{fontSize:14,fontWeight:700,color:C.text}}>{T.dragFolder}</div>
            <div style={{fontSize:12,color:C.dim,textAlign:"center",lineHeight:1.7,maxWidth:260}}>{T.supportMesh}</div>
            <div style={{width:"100%",padding:12,borderRadius:8,border:`1px dashed ${C.border}`,fontSize:11,color:C.dim,lineHeight:1.8}}>
              <div style={{fontFamily:"monospace"}}>your_robot/<br/>├── urdf/robot.urdf<br/>└── meshes/*.stl</div>
            </div>
            <button className="fb" style={{width:"100%",padding:"10px",borderRadius:8,border:`1px solid ${C.accent}44`,background:`${C.accent}11`,color:C.accent,fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={()=>folderRef.current?.click()}>{T.selectFolder}</button>
          </div>
        ):(<>
          {/* Tab bar */}
          <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
            <TabBtn id="joints" label={T.jointCtrl}/>
            <TabBtn id="links" label={T.jointOpacity}/>
            <TabBtn id="tree" label={T.folder}/>
          </div>

          {/* Tab content */}
          <div style={{flex:1,overflowY:"auto"}}>
            {/* ── Joints tab ── */}
            {sidebarTab==="joints"&&(
              <div style={{padding:"8px 0"}}>
                {jEntries.length===0&&<div style={{padding:20,textAlign:"center",color:C.dim,fontSize:12}}>{T.noJoints}</div>}
                {jEntries.map(([name,value])=>{
                  const o=jointObjRef.current[name];if(!o)return null;
                  const{lower,upper,jointType}=o.userData;
                  return(
                    <div key={name} className="ji" style={{padding:"10px 20px",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>{jointType}</div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <span style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180}} title={name}>{name}</span>
                        <span style={{fontSize:11,color:C.accent,fontVariantNumeric:"tabular-nums"}}>{value.toFixed(3)}</span>
                      </div>
                      <input type="range" style={{width:"100%",appearance:"none",WebkitAppearance:"none",height:4,borderRadius:2,background:C.border,outline:"none",cursor:"pointer"}} min={lower} max={upper} step={0.001} value={value} onChange={e=>updateJoint(name,+e.target.value)}/>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.dim,marginTop:4}}><span>{lower.toFixed(2)}</span><span>{upper.toFixed(2)}</span></div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Links opacity tab ── */}
            {sidebarTab==="links"&&(
              <div style={{padding:"8px 0"}}>
                {/* Global controls */}
                <div style={{padding:"8px 20px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:6}}>
                  <button className="cb" onClick={()=>{const lo={};for(const ln of linkNames)lo[ln]=1;setLinkOpacities(lo);}} style={{flex:1,padding:"5px",borderRadius:5,border:`1px solid ${C.border}`,background:C.bg,color:C.dim,fontSize:10,fontWeight:600,cursor:"pointer"}}>{T.showAll}</button>
                  <button className="cb" onClick={()=>{const lo={};for(const ln of linkNames)lo[ln]=0.3;setLinkOpacities(lo);}} style={{flex:1,padding:"5px",borderRadius:5,border:`1px solid ${C.border}`,background:C.bg,color:C.dim,fontSize:10,fontWeight:600,cursor:"pointer"}}>{T.halfTrans}</button>
                  <button className="cb" onClick={()=>{const lo={};for(const ln of linkNames)lo[ln]=0;setLinkOpacities(lo);}} style={{flex:1,padding:"5px",borderRadius:5,border:`1px solid ${C.border}`,background:C.bg,color:C.dim,fontSize:10,fontWeight:600,cursor:"pointer"}}>{T.hideAll}</button>
                </div>
                {linkNames.map(ln=>{
                  const op=linkOpacities[ln]??1;
                  const hasI=robot.links[ln]?.inertial;
                  return(
                    <div key={ln} className="lk-row" style={{padding:"8px 20px",borderBottom:`1px solid ${C.border}22`,display:"flex",alignItems:"center",gap:10}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:600,color:op>0?C.text:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={ln}>{ln}</div>
                        {hasI&&<div style={{fontSize:9,color:C.dim}}>m={hasI.mass.toFixed(3)}kg</div>}
                      </div>
                      <input type="range" min={0} max={1} step={0.05} value={op} onChange={e=>setLinkOpacities(prev=>({...prev,[ln]:+e.target.value}))}
                        style={{width:80,appearance:"none",WebkitAppearance:"none",height:3,borderRadius:2,background:C.border,outline:"none",cursor:"pointer"}}/>
                      <span style={{fontSize:10,color:op>0.5?C.accent:C.dim,fontVariantNumeric:"tabular-nums",width:28,textAlign:"right"}}>{(op*100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Browser tab ── */}
            {sidebarTab==="tree"&&(
              <div style={{padding:"8px 0"}}>
                <TreeBrowser files={files} urdfTree={urdfTree} folderTree={folderTree} robot={robot} T={T} C={C}/>
              </div>
            )}
          </div>

          <button className="rb" style={{padding:"8px 16px",margin:"8px 20px 4px",background:`${C.danger}22`,border:`1px solid ${C.danger}44`,borderRadius:6,color:C.danger,fontSize:11,fontWeight:600,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.08em",textAlign:"center"}} onClick={resetJoints}>{T.resetJoints}</button>
          <button className="rb" style={{padding:"8px 16px",margin:"0 20px 10px",background:`${C.accent}22`,border:`1px solid ${C.accent}44`,borderRadius:6,color:C.accent,fontSize:11,fontWeight:600,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.08em",textAlign:"center"}}
            onClick={()=>{if(offsetGroupRef.current&&sceneRef.current)sceneRef.current.remove(offsetGroupRef.current);offsetGroupRef.current=null;worldGroupRef.current=null;robotGroupRef.current=null;jointObjRef.current={};linkObjRef.current={};comRef.current=[];inertiaRef.current=[];axisRef.current=[];setRobot(null);setJointVals({});setFiles([]);setLinkOpacities({});lookTarget.current.set(0,0.3,0);camAngle.current={theta:Math.PI/4,phi:Math.PI/3,radius:2};updateCam();}}>{T.unload}</button>
        </>)}
      </div>

      {dragging&&(<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(10,14,23,0.95)",zIndex:100,gap:16,border:`3px dashed ${C.accent}`}}><div style={{width:80,height:80,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:`${C.accent}15`,border:`2px solid ${C.accent}44`,fontSize:36}}>📁</div><div style={{fontSize:18,fontWeight:700,color:C.text}}>{T.dropRelease}</div></div>)}
      {error&&(<div style={{position:"absolute",top:16,left:"50%",transform:"translateX(-50%)",padding:"10px 20px",background:`${C.danger}22`,border:`1px solid ${C.danger}44`,borderRadius:8,color:C.danger,fontSize:12,zIndex:200,maxWidth:500,textAlign:"center"}}>{error}<span style={{marginLeft:12,cursor:"pointer",opacity:0.6}} onClick={()=>setError(null)}>✕</span></div>)}
    </div>
  );
}

// ─── URDF Tree Node (collapsible recursive) ─────────────────
function URDFLinkNode({node,robot,depth=0}){
  const C=C_DARK;
  const[open,setOpen]=useState(depth<4);
  const hasChildren=node.children&&node.children.length>0;
  const hasI=node.inertial;
  return(
    <div>
      <div className="lk-row" onClick={()=>hasChildren&&setOpen(!open)} style={{paddingLeft:depth*14+8,padding:`4px 8px 4px ${depth*14+8}px`,display:"flex",alignItems:"center",gap:5,fontSize:11,cursor:hasChildren?"pointer":"default",userSelect:"none"}}>
        {hasChildren?<span style={{fontSize:8,color:C.dim,width:10,flexShrink:0}}>{open?"▼":"▶"}</span>:<span style={{width:10,flexShrink:0}}/>}
        <span style={{color:"#34d399",fontSize:10,flexShrink:0}}>■</span>
        <span style={{fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={node.name}>{node.name}</span>
        {hasI&&<span style={{fontSize:9,color:C.dim,marginLeft:"auto",flexShrink:0}}>{hasI.mass.toFixed(2)}kg</span>}
      </div>
      {open&&node.children.map((joint,i)=>(
        <URDFJointNode key={i} joint={joint} robot={robot} depth={depth+1}/>
      ))}
    </div>
  );
}
function URDFJointNode({joint,robot,depth}){
  const C=C_DARK;
  const[open,setOpen]=useState(depth<3);
  const axisStr=joint.axis?`[${joint.axis.join(",")}]`:"";
  return(
    <div>
      <div className="lk-row" onClick={()=>setOpen(!open)} style={{paddingLeft:depth*14+8,padding:`3px 8px 3px ${depth*14+8}px`,display:"flex",alignItems:"center",gap:5,fontSize:10,color:C.dim,cursor:"pointer",userSelect:"none"}}>
        <span style={{fontSize:8,color:C.dim,width:10,flexShrink:0}}>{open?"▼":"▶"}</span>
        <span style={{color:joint.jointType==="fixed"?"#666":"#ffaa00",fontSize:9,flexShrink:0}}>{joint.jointType==="fixed"?"○":"◎"}</span>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={joint.name}>{joint.name}</span>
        <span style={{fontSize:9,color:C.dim,marginLeft:"auto",flexShrink:0}}>{joint.jointType} {axisStr}</span>
      </div>
      {open&&joint.child&&<URDFLinkNode node={joint.child} robot={robot} depth={depth+1}/>}
    </div>
  );
}

// ─── Tree Browser sub-component ──────────────────────────────
function TreeBrowser({files,urdfTree,folderTree,robot,T,C=C_DARK}){
  const[view,setView]=useState("urdf");
  return(
    <div>
      <div style={{display:"flex",padding:"0 16px 8px",gap:6}}>
        <button className="cb" onClick={()=>setView("urdf")} style={{flex:1,padding:"5px",borderRadius:5,border:`1px solid ${view==="urdf"?C.accent:C.border}`,background:view==="urdf"?`${C.accent}15`:C.bg,color:view==="urdf"?C.accent:C.dim,fontSize:10,fontWeight:600,cursor:"pointer"}}>{T.urdfTree}</button>
        <button className="cb" onClick={()=>setView("folder")} style={{flex:1,padding:"5px",borderRadius:5,border:`1px solid ${view==="folder"?C.accent:C.border}`,background:view==="folder"?`${C.accent}15`:C.bg,color:view==="folder"?C.accent:C.dim,fontSize:10,fontWeight:600,cursor:"pointer"}}>{T.folderTree}</button>
      </div>
      {view==="urdf"&&urdfTree&&(
        <div style={{padding:"0 4px"}}><URDFLinkNode node={urdfTree} robot={robot} depth={0}/></div>
      )}
      {view==="urdf"&&!urdfTree&&(
        <div style={{padding:20,textAlign:"center",color:C.dim,fontSize:12}}>{T.noFolderData}</div>
      )}
      {view==="folder"&&folderTree&&(
        <div style={{padding:"0 8px"}}><FolderNode node={folderTree} name="root" depth={0} C={C}/></div>
      )}
      {view==="folder"&&!folderTree&&(
        <div style={{padding:20,textAlign:"center",color:C.dim,fontSize:12}}>{T.noFolderData}</div>
      )}
    </div>
  );
}

// end of file
