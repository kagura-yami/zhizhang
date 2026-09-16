// Rebuild: set NODE_PATH to the bundled node_modules, then node build-deck.js.
// Native background panels intentionally contain their foreground text.
const pptxgen = require('pptxgenjs');
const {autoFontSize,warnIfSlideHasOverlaps,warnIfSlideElementsOutOfBounds} = require(process.env.SLIDES_HELPERS_PATH || '../../output/metropolis-2026/pptxgenjs_helpers');
const path = require('path');
const pptx = new pptxgen();
pptx.layout='LAYOUT_WIDE';
pptx.author='知账'; pptx.subject='Metropolis 2026 产品方案与路演';
pptx.title='知账｜让每一笔消费，都有据可复盘';
pptx.company='知账'; pptx.lang='zh-CN';
pptx.theme={headFontFace:'Microsoft YaHei',bodyFontFace:'Microsoft YaHei',lang:'zh-CN'};
const C={bg:'FAF7EC',ink:'191C19',muted:'666A62',yellow:'FFD426',mint:'C9F1D9',line:'D8D9CE',purple:'E4DAFA',white:'FFFFFF'};
function text(s,t,x,y,w,h,size=22,color=C.ink,bold=false){
 const o=autoFontSize(t,'Microsoft YaHei',{x,y,w,h,fontSize:size,minFontSize:size,maxFontSize:size,mode:'auto'});
 delete o.fit; delete o.autoFit;
 s.addText(t,{...o,fontFace:'Microsoft YaHei',color,bold,margin:0,breakLine:false,valign:'mid',paraSpaceAfterPt:0});
}
function rect(s,x,y,w,h,fill=C.white,line=C.ink){s.addShape(pptx.ShapeType.rect,{x,y,w,h,fill:{color:fill},line:{color:line,width:1.4}});}
function line(s,x,y,w,color=C.line){s.addShape(pptx.ShapeType.line,{x,y,w,h:0,line:{color,width:1}});}
function base(k,title,sub){const s=pptx.addSlide();s.background={color:C.bg};text(s,'知账  /  ZHIZHANG',.55,.3,6,.3,11,C.muted,true);text(s,k,9.7,.3,3,.3,10,C.muted);text(s,title,.55,1.04,12.2,.75,32,C.ink,true);if(sub)text(s,sub,.57,1.94,12.1,.6,16,C.muted);line(s,.55,6.9,12.2);text(s,'TRACK 02 · 2026-09-17 · 0.0.152 已上线 / 真实模型与支付待验收',.55,7.04,11.4,.2,9,C.muted);text(s,String(pptx._slides.length).padStart(2,'0'),12.12,7.01,.5,.27,11,C.muted);return s;}
function panel(s,x,y,w,h,tag,title,body,fill=C.white){rect(s,x,y,w,h,fill);text(s,tag,x+.22,y+.22,w-.44,.35,12,C.muted,true);text(s,title,x+.22,y+.82,w-.44,.7,23,C.ink,true);text(s,body,x+.22,y+1.67,w-.44,h-1.9,18,C.ink);}

let s=base('TRACK 02 / CONSUMER PRODUCTS & PAYMENTS','从消费记录，到有据行动','知账 Zhizhang · 私密评账与 AI 消费复盘');
text(s,'记对账\n再作决定',.65,2.8,6.4,2.35,51,C.ink,true);
rect(s,7.7,2.9,4.95,2.9,C.yellow);
text(s,'记录 → 反馈 → 复盘',8,3.32,4.35,.65,25,C.ink,true);
text(s,'拟探索：用户确认的链上分账\n连接消费记录与结算结果',8,4.32,4.3,1,20);
s.addNotes('开场用30秒介绍。已有Android与云端基础；本次新增社群和复盘已部署；真实模型、系统推送和原生端到端验收尚未完成；支付为候选设计。');

s=base('01 / PROBLEM','先把账记对，再讨论怎么花','真实问题：优惠券被误识别为收入，会污染后续统计和建议');
panel(s,.6,2.95,3.86,3.1,'记录','自动识别要准确','券提醒不是收入。\n退款与转账需分别处理。');
panel(s,4.74,2.95,3.86,3.1,'理解','数字缺少上下文','一张支出饼图，未必解释\n这笔钱对我是否值得。',C.yellow);
panel(s,8.88,2.95,3.86,3.1,'行动','建议需要依据','能追溯到记录与反馈，\n也明确哪些数据缺失。');
s.addNotes('问题来自用户反馈与产品假设，不是大样本调研。不能承诺AI一定省钱。');

s=base('02 / PRODUCT','在已有记账产品上，补齐反馈闭环','自动记账是主功能 · 社群在设置中自愿开启');
[['01','自动记录','保存后自动计入'],['02','私密评账','社群内主动授权'],['03','有据复盘','事实与建议分开'],['04','消费行动','少量可执行建议']].forEach((a,i)=>{let x=.6+i*3.1;rect(s,x,3.03,2.78,2.3,i===2?C.yellow:C.white);text(s,a[0],x+.2,3.25,2.38,.4,15,C.muted);text(s,a[1],x+.2,3.96,2.38,.55,25,C.ink,true);text(s,a[2],x+.2,4.73,2.38,.32,13,C.muted);});
text(s,'社群关闭不影响记账；开启后自动参榜，默认隐藏金额。',.67,5.95,11.8,.55,23);
s.addNotes('既有能力与本次新增分开说明；没有经过核验的增长或留存数字。');

s=base('03 / PRIVATE FEEDBACK','同一笔账单，两段私密对话','合成示例 · 关注关系不等于账单访问权');
panel(s,.6,2.95,3.86,3.1,'账单主人 A','支出 ¥168','娱乐 · 昨日\n可分别看到 B 与 C',C.yellow);
panel(s,4.74,2.95,3.86,3.1,'评价者 B','夯 · 值得','“用了很久，值得。”\n只看自己与 A 的对话',C.mint);
panel(s,8.88,2.95,3.86,3.1,'评价者 C','拉 · 再想想','“先检查已有订阅？”\n只看自己与 A 的对话',C.purple);
text(s,'仅类型 / 金额 / 分类 / 时间；原通知、备注不开放。',.67,6.3,12,.35,17,C.muted);
s.addNotes('真实Demo需切换账号并验证B/C无法读取彼此线程；主人可撤权，拉黑终止访问。');

s=base('04 / AI REVIEW','事实、朋友观点、AI 建议分开','用户自配 API · 仅已结束日/月 · 下列为报告结构示例');
[['事实','1,000 收入 − 200 支出 + 50 退款 = 850 结余','金额由服务端计算；内部转账不计入'],['观点','“下次先检查已有订阅。”','仅使用有权读取、获准送 AI 的当前评价'],['建议','订阅前先核对是否已有重复服务。','最多三条行动，附来源；预算缺失明确提示']].forEach((a,i)=>{let y=2.94+i*1.13;rect(s,.65,y,1.1,.84,i===2?C.yellow:C.mint);text(s,a[0],.79,y+.2,.84,.4,20,C.ink,true);text(s,a[1],2.06,y,10.35,.47,22,C.ink,true);text(s,a[2],2.06,y+.57,10.3,.3,14,C.muted);});
s.addNotes('真实模型未验收不称为真实模型成功输出。作业已部署，分批长上下文已通过模拟服务验证；用户自配API网关当前502，未通过真实模型验收。');

s=base('05 / TRACK 02 PROPOSAL','从消费记录，连接用户确认的结算','候选设计 / 未实现 · 具体支付模式待确定');
[['AI 整理草案','识别参与者与分摊建议'],['用户核对并签名','确认资产、金额、收款方'],['Monad 结算','核对交易回执与实际结果'],['账本对账','关联原账，防止重复记录']].forEach((a,i)=>{let y=2.86+i*.81;rect(s,.65,y,3.65,.64,i===1?C.yellow:C.white);text(s,a[0],.84,y+.1,3.25,.4,20,C.ink,true);text(s,a[1],4.8,y+.1,7.65,.4,22);});
text(s,'评账授权 ≠ 支付授权；AI 不持有私钥。',.7,6.38,11.9,.3,18,C.muted);
s.addNotes('这一页为设计，不是真实支付Demo。测试币与人民币分开，不能把原账人民币金额直接当成稳定币数量。');

s=base('06 / WHY ONCHAIN','让支付参与者能独立核对结算','价值假设待真实测试网闭环验证，不宣称独占技术优势');
panel(s,.6,2.95,3.86,3.1,'用户掌控','各自钱包签名','不维护托管余额。\n每次支付单独确认。');
panel(s,4.74,2.95,3.86,3.1,'可核对','结果不只在 App','交易结果可独立查询，\n再关联回原始账单。',C.yellow);
panel(s,8.88,2.95,3.86,3.1,'边界','私密数据不上链','不公开评论和通知。\n真实成本与耗时待测。');
s.addNotes('也可在其他EVM网络实现；Monad选择结合赛事生态，不能声称测试过性能。地址、金额及时间可能公开关联身份。');

s=base('07 / STATUS & ASK','已有基础，下一步用真实闭环验证','本次主讲结束页 · 已发布 0.0.152 / Android 173');
text(s,'已部署的能力',.72,2.95,5.6,.55,28,C.ink,true);
text(s,'自动记账 · 可选社群\n排行榜 · 专用 AI 复盘',.74,3.91,5.5,1.2,25);
text(s,'仍待完成',7,2.95,5.6,.55,28,C.ink,true);
text(s,'真实模型 / 系统推送 / 真机验收\n支付场景确认与测试网闭环',7.02,3.91,5.5,1.2,22);
rect(s,.66,5.73,12,.73,C.yellow);text(s,'寻找结伴试用的用户，以及钱包结算体验的生态反馈',.94,5.9,11.4,.38,22,C.ink,true);
s.addNotes('先验证邀请接受、复盘返回、引用准确；支付确定后测结算完成率。不编造用户规模、收入和节省金额。');

s=base('APPENDIX A / ARCHITECTURE','复用现有架构，资金能力独立设计','React Native 0.81 / NestJS 10 / Prisma 6 / PostgreSQL');
[['账务','通知解析 → Bill → LedgerService → 首页 / 预算 / 统计'],['社群','SocialAccessService → 四字段投影 → 私密线程'],['AI','证据与历史预算 → 持久化作业 → 模型 → 私有报告'],['候选支付','分账意图 → 用户签名 → receipt 校验 → 幂等对账']].forEach((a,i)=>{let y=2.9+i*.82;rect(s,.65,y,1.7,.64,i===3?C.yellow:C.white);text(s,a[0],.83,y+.12,1.35,.37,20,C.ink,true);text(s,a[1],2.8,y+.1,9.85,.44,21);});
s.addNotes('当前已存在ledger/social/reviews/moderation/inbox/rankings和retrospective相关代码；候选支付尚未实现。');

s=base('APPENDIX B / DEMO','两分钟演示，只讲当天可验证的能力','合成账号与数据 · 没有真实模型结果则展示结构示意');
[['00–20s','账务输入','自动计入；关闭社群仍正常记账'],['20–55s','私密评账','打开底部社群，授权并验证隔离'],['55–85s','有据复盘','社群内复盘，说明用户自配 API'],['85–120s','隐私与支付提案','自动参榜、隐藏金额；支付未实现']].forEach((a,i)=>{let y=2.91+i*.82;text(s,a[0],.7,y,1.65,.5,19,C.muted);text(s,a[1],2.6,y,2.55,.5,22,C.ink,true);text(s,a[2],5.45,y,7.15,.5,20);});
s.addNotes('会前准备真实录屏备份；无需投屏生产后台。真实链支付未完成，不展示假的交易哈希。来源：Monad Metropolis官网及Rise In活动页；文档含完整讲稿与引用。');

for(const slide of pptx._slides){
 warnIfSlideHasOverlaps(slide,pptx); // Intentional containment: text sits inside background panels.
 warnIfSlideElementsOutOfBounds(slide,pptx);
}
pptx.writeFile({fileName:path.join(process.env.DECK_OUTPUT_DIR || path.resolve(__dirname,'../../output/metropolis-2026'),'知账-Metropolis-Track02.pptx')});
