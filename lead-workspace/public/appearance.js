// Runs before styles so a saved appearance does not flash the other theme.
(()=>{
  const root=document.documentElement;
  const read=()=>{try{return localStorage.getItem('bolt-theme-v1');}catch{return null;}};
  function sync(){
    const light=root.dataset.theme==='light';
    document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
      button.textContent=light?'Dark mode':'Light mode';
      button.setAttribute('aria-label',light?'Switch to dark mode':'Switch to light mode');
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',light?'#f4f2eb':'#171e1c');
    document.querySelectorAll('[data-motion-toggle]').forEach(button=>{button.textContent=root.dataset.motion==='paused'?'Resume background motion':'Pause background motion';});
  }
  function set(theme){
    root.dataset.theme=theme==='dark'?'dark':'light';
    root.style.colorScheme=root.dataset.theme;
    try{localStorage.setItem('bolt-theme-v1',root.dataset.theme);}catch{}
    sync();
  }
  function toggleMotion(){root.dataset.motion=root.dataset.motion==='paused'?'running':'paused';try{localStorage.setItem('bolt-motion-v1',root.dataset.motion);}catch{}sync();}
  try{root.dataset.motion=localStorage.getItem('bolt-motion-v1')==='paused'?'paused':'running';}catch{root.dataset.motion='running';}
  window.BoltAppearance={sync,toggle:()=>set(root.dataset.theme==='light'?'dark':'light'),toggleMotion};
  set(read()==='dark'?'dark':'light');
})();
