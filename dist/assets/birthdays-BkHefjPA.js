var u=Object.defineProperty,k=Object.defineProperties;var b=Object.getOwnPropertyDescriptors;var _=Object.getOwnPropertySymbols;var w=Object.prototype.hasOwnProperty,f=Object.prototype.propertyIsEnumerable;var d=(e,t,a)=>t in e?u(e,t,{enumerable:!0,configurable:!0,writable:!0,value:a}):e[t]=a,h=(e,t)=>{for(var a in t||(t={}))w.call(t,a)&&d(e,a,t[a]);if(_)for(var a of _(t))f.call(t,a)&&d(e,a,t[a]);return e},y=(e,t)=>k(e,b(t));import{c as l,s as i,b8 as m}from"./index-C03hn3Jp.js";/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B=l("BookMarked",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["polyline",{points:"10 2 10 10 13 7 16 10 16 2",key:"13o6vz"}]]);/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=l("ScrollText",[["path",{d:"M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4",key:"13a6an"}],["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M15 8h-5",key:"1khuty"}],["path",{d:"M15 12h-5",key:"r7krc0"}]]);async function x(e,t){const{data:a,error:n}=await i.rpc("get_birthday_conversation",{p_celebration_id:e,p_date:t});if(n)throw n;return a}async function H(e,t,a,n){const{error:o}=await i.rpc("set_birthday_reaction",{p_celebration_id:e,p_date:t,p_reaction_type:a,p_reacted:n});if(o)throw o}async function z(e,t,a,n,o){const{error:r}=await i.rpc("save_birthday_wish",{p_celebration_id:e,p_date:t,p_body:a,p_id:n||null,p_parent_id:o||null});if(r)throw r}async function A(e,t){var c,s,p;const{data:a,error:n}=await i.rpc("get_public_birthday_announcement",{p_celebration_id:e,p_date:t});if(n)throw n;if(!a||typeof a!="object")return null;const o=a,r=(c=o.artwork)!=null&&c.content?m({content:o.artwork.content,image_position_x:(s=o.artwork.image_position_x)!=null?s:void 0,image_position_y:(p=o.artwork.image_position_y)!=null?p:void 0}):null;return y(h({},o),{panel_image:r})}export{B,M as S,x as a,H as b,A as f,z as s};
