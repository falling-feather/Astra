/* Presentation bridge for this local resource copy; it carries no account or learning records. */
(()=>{
  const embedded=window.parent!==window;
  const overview=new URL('../observatory.html',document.currentScript.src);
  const original=new URL('../labs/index.html',document.currentScript.src);
  const send=type=>{if(embedded)parent.postMessage({namespace:'astra-lab-explorer',type,href:location.pathname+location.search+location.hash},location.origin);};
  function isOverview(link){
    const url=new URL(link.href,location.href);
    return url.origin===overview.origin&&(
      url.pathname===overview.pathname||
      url.pathname.replace(/\/index\.html$/,'/')===original.pathname.replace(/\/index\.html$/,'/')&&url.hash==='#planets'
    );
  }
  function redirect(link){
    link.href=overview.href;link.target='_top';link.removeAttribute('data-page');
  }
  for(const link of document.querySelectorAll('a[href]'))if(isOverview(link))redirect(link);
  window.addEventListener('load',()=>send('ready'),{once:true});
  window.addEventListener('hashchange',()=>send('route'));
  window.addEventListener('popstate',()=>send('route'));
  // The imported router also changes URLs without a hashchange event.
  if(embedded)for(const method of ['pushState','replaceState']){
    const originalMethod=history[method];
    history[method]=function(...args){
      const before=location.href,result=originalMethod.apply(this,args);
      if(location.href!==before)send('route');
      return result;
    };
  }
  if(document.readyState==='complete')send('ready');
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!link||!isOverview(link))return;
    redirect(link);
    // Stop the original router before it can open the retired galaxy directory.
    event.stopPropagation();
    if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button>0)return;
    if(embedded){event.preventDefault();send('return');}
  },true);
})();
