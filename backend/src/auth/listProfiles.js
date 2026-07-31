import { adsRequest } from '../adsClient.js';

// Lists the advertising profiles your account can access. Each profile is one
// marketplace (US, UK, DE, …). Copy the profileId you want into ADS_PROFILE_ID.
adsRequest({ path: '/v2/profiles', profileId: '' })
  .then((profiles) => {
    if (!Array.isArray(profiles) || profiles.length === 0) {
      console.log('No profiles returned. Is this account registered for advertising?');
      return;
    }
    console.log(`\nFound ${profiles.length} profile(s):\n`);
    for (const p of profiles) {
      const cc = p.countryCode || '??';
      const type = p.accountInfo?.type || '?';
      const name = p.accountInfo?.name || '(no name)';
      console.log(`  profileId: ${p.profileId}`);
      console.log(`     ${cc} · ${type} · ${name} · ${p.currencyCode || ''}\n`);
    }
    console.log('➡️  Put the profileId you want into backend/.env as ADS_PROFILE_ID\n');
  })
  .catch((e) => {
    console.error('❌', e.message);
    console.error('   Check that ADS_REFRESH_TOKEN is set and the region host is correct.');
    process.exit(1);
  });
