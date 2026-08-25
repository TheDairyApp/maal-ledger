const SUPABASE_URL = "https://soopgkgqsnutxhkgfova.supabase.co"; 
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvb3Bna2dxc251dHhoa2dmb3ZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2Njg1MDYsImV4cCI6MjEwMzI0NDUwNn0.JKnPTbrkgLgJodhvDbHrpsquP8C55QpScUeZ34iBFew";

const { createClient } = window.supabase;
const dbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
