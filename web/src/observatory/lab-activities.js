import { experimentHref,filterLabActivities } from './lab-catalog.js';

export function appendLabActivities(container,topic){
  const doc=container.ownerDocument,section=doc.createElement('section');section.className='lab-activities';section.setAttribute('aria-label',topic.title+'实验目录');
  const header=doc.createElement('div');header.className='lab-list-heading';
  const heading=doc.createElement('h4');heading.textContent=`${topic.activities.length} 项实验与活动`;
  const label=doc.createElement('label');label.className='lab-search-label';label.append('筛选实验 ');
  const input=doc.createElement('input');input.type='search';input.placeholder='输入实验名称';input.setAttribute('aria-label','筛选'+topic.title+'实验');
  label.append(input);header.append(heading,label);
  const count=doc.createElement('p');count.className='lab-list-count';count.setAttribute('role','status');
  const list=doc.createElement('div');list.className='lab-activity-list';
  function render(){
    const matches=filterLabActivities(topic.activities,input.value);list.replaceChildren();count.textContent=matches.length===topic.activities.length?'选择一项，进入实验':`找到 ${matches.length} 项实验`;
    for(const item of matches){
      const link=doc.createElement('a');link.className='lab-activity-link';link.href=experimentHref(item.key);link.dataset.labKey=item.key;
      const copy=doc.createElement('span'),title=doc.createElement('strong'),summary=doc.createElement('small'),enter=doc.createElement('span');
      title.textContent=item.title;summary.textContent=item.summary;enter.className='lab-enter';enter.textContent='进入实验 →';copy.append(title,summary);link.append(copy,enter);list.append(link);
    }
    if(!matches.length){const empty=doc.createElement('p');empty.className='lab-list-empty';empty.textContent='没有找到相关实验，试试其他名称。';list.append(empty);}
  }
  input.addEventListener('input',render);section.append(header,count,list);container.append(section);render();
}
