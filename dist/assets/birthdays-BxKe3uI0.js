var l=Object.defineProperty,u=Object.defineProperties;var m=Object.getOwnPropertyDescriptors;var d=Object.getOwnPropertySymbols;var f=Object.prototype.hasOwnProperty,v=Object.prototype.propertyIsEnumerable;var h=(o,t,a)=>t in o?l(o,t,{enumerable:!0,configurable:!0,writable:!0,value:a}):o[t]=a,y=(o,t)=>{for(var a in t||(t={}))f.call(t,a)&&h(o,a,t[a]);if(d)for(var a of d(t))v.call(t,a)&&h(o,a,t[a]);return o},k=(o,t)=>u(o,m(t));import{c,s as i,c3 as w}from"./index-CUtqqjNa.js";/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=c("BookMarked",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["polyline",{points:"10 2 10 10 13 7 16 10 16 2",key:"13o6vz"}]]);/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=c("Bookmark",[["path",{d:"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",key:"1fy3hk"}]]);/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const V=c("Quote",[["path",{d:"M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z",key:"4rm80e"}],["path",{d:"M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z",key:"10za9r"}]]);/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const z=c("ScrollText",[["path",{d:"M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4",key:"13a6an"}],["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M15 8h-5",key:"1khuty"}],["path",{d:"M15 12h-5",key:"r7krc0"}]]);async function x(o,t){const{data:a,error:r}=await i.rpc("get_birthday_conversation",{p_celebration_id:o,p_date:t});if(r)throw r;return a}async function H(o,t,a,r){const{error:e}=await i.rpc("set_birthday_reaction",{p_celebration_id:o,p_date:t,p_reaction_type:a,p_reacted:r});if(e)throw e}async function A(o,t,a,r,e){const{error:n}=await i.rpc("save_birthday_wish",{p_celebration_id:o,p_date:t,p_body:a,p_id:r||null,p_parent_id:e||null});if(n)throw n}async function Q(o,t){var s,p,_;const{data:a,error:r}=await i.rpc("get_public_birthday_announcement",{p_celebration_id:o,p_date:t});if(r)throw r;if(!a||typeof a!="object")return null;const e=a,n=(s=e.artwork)!=null&&s.content?w({content:e.artwork.content,image_position_x:(p=e.artwork.image_position_x)!=null?p:void 0,image_position_y:(_=e.artwork.image_position_y)!=null?_:void 0}):null;return k(y({},e),{panel_image:n})}export{g as B,V as Q,z as S,A as a,M as b,Q as c,x as f,H as s};
