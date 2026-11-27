var l=Object.defineProperty,u=Object.defineProperties;var m=Object.getOwnPropertyDescriptors;var d=Object.getOwnPropertySymbols;var b=Object.prototype.hasOwnProperty,f=Object.prototype.propertyIsEnumerable;var h=(o,t,a)=>t in o?l(o,t,{enumerable:!0,configurable:!0,writable:!0,value:a}):o[t]=a,y=(o,t)=>{for(var a in t||(t={}))b.call(t,a)&&h(o,a,t[a]);if(d)for(var a of d(t))f.call(t,a)&&h(o,a,t[a]);return o},k=(o,t)=>u(o,m(t));import{c,s as i,bg as w}from"./index-CdHq9ZJz.js";/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B=c("BookMarked",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["polyline",{points:"10 2 10 10 13 7 16 10 16 2",key:"13o6vz"}]]);/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=c("Bookmark",[["path",{d:"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",key:"1fy3hk"}]]);/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=c("ScrollText",[["path",{d:"M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4",key:"13a6an"}],["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M15 8h-5",key:"1khuty"}],["path",{d:"M15 12h-5",key:"r7krc0"}]]);async function H(o,t){const{data:a,error:n}=await i.rpc("get_birthday_conversation",{p_celebration_id:o,p_date:t});if(n)throw n;return a}async function z(o,t,a,n){const{error:e}=await i.rpc("set_birthday_reaction",{p_celebration_id:o,p_date:t,p_reaction_type:a,p_reacted:n});if(e)throw e}async function A(o,t,a,n,e){const{error:r}=await i.rpc("save_birthday_wish",{p_celebration_id:o,p_date:t,p_body:a,p_id:n||null,p_parent_id:e||null});if(r)throw r}async function S(o,t){var s,p,_;const{data:a,error:n}=await i.rpc("get_public_birthday_announcement",{p_celebration_id:o,p_date:t});if(n)throw n;if(!a||typeof a!="object")return null;const e=a,r=(s=e.artwork)!=null&&s.content?w({content:e.artwork.content,image_position_x:(p=e.artwork.image_position_x)!=null?p:void 0,image_position_y:(_=e.artwork.image_position_y)!=null?_:void 0}):null;return k(y({},e),{panel_image:r})}export{M as B,x as S,B as a,H as b,z as c,S as f,A as s};
