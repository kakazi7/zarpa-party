// Single place for backend settings. The publishable key is public by design.
globalThis.ZARPA_CONFIG = {
  url: 'https://vkqssgslhzpkixdeemcy.supabase.co',
  key: 'sb_publishable_W5793b8Py5Cvox_t6Lpl3g_STskGyYq',
  // Legacy anon JWT, tried automatically if the publishable key is rejected.
  fallbackKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrcXNzZ3NsaHpwa2l4ZGVlbWN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwNDQ5MDcsImV4cCI6MjEwNjYyMDkwN30.Av_3OVhkCWB65R8yQd_IKaZgopDpnJVv4Rsj-gxjHDU',
  channelPrefix: 'zarpa-party:',
  debug: false, // true = verbose console.debug logging
};
