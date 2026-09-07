/// <reference types="vite/client" />
declare module 'virtual:astra-catalog' {
  const activities: import('./portal/contracts').Activity[];
  export default activities;
}
