// Everything under /api goes to the game server Worker (same origin, so no CORS and no separate address).
export async function onRequest({request,env}){
  if(!env.API)return new Response("Server nicht verbunden",{status:503});
  return env.API.fetch(request);
}
