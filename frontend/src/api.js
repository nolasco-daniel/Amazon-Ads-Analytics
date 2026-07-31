import axios from 'axios';

const http = axios.create({ baseURL: '/api' });

export const getKpis = (params) => http.get('/kpis', { params }).then((r) => r.data);
export const getSeries = (params) => http.get('/series', { params }).then((r) => r.data);
export const getCampaigns = (params) => http.get('/campaigns', { params }).then((r) => r.data);
export const getSearchTerms = (params) => http.get('/searchterms', { params }).then((r) => r.data);
export const getAgentSummary = (params) => http.get('/agent/summary', { params }).then((r) => r.data);
export const getPeriodic = (params) => http.get('/agent/periodic', { params }).then((r) => r.data);
export const getCompare = (params) => http.get('/agent/compare', { params }).then((r) => r.data);
export const uploadReport = (kind, date, content) =>
  http.post('/agent/upload', content, {
    params: { kind, date },
    headers: { 'Content-Type': 'text/csv' },
  }).then((r) => r.data);
export const refreshData = (days = 14) => http.post('/refresh', { days }).then((r) => r.data);
export const getRefreshStatus = () => http.get('/refresh/status').then((r) => r.data);
// Conversational AI assistant. `messages` is the plain-text history so far.
export const sendChat = (messages, profileId) =>
  http.post('/chat', { messages, profileId }).then((r) => r.data);
