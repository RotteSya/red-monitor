// #60 Pro M2 PoC — X List member filter wiring and runtime contracts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const gate = readFileSync(resolve(repo, 'src/premium/license/gate.js'), 'utf8');
const bridge = readFileSync(resolve(repo, 'bridge.js'), 'utf8');
const filter = readFileSync(resolve(repo, 'src/premium/list-member-filter/filter.js'), 'utf8');
const source = readFileSync(resolve(repo, 'src/premium/list-member-filter/member-source.js'), 'utf8');
const popup = readFileSync(resolve(repo, 'src/premium/list-member-filter/popup-list-member-filter.js'), 'utf8');
const html = readFileSync(resolve(repo, 'popup.html'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));

describe('#60 Pro M2 — X List member filter PoC', () => {
  it('declares list-member-filter as a gated Trial/Pro feature', () => {
    expect(/['"]list-member-filter['"]\s*:\s*['"]trial['"]/.test(gate),
      'gate.js FEATURE_TIER must include list-member-filter as trial/pro'
    ).toBe(true);
    expect(filter).toMatch(/__xvmPro\?\.isFeatureEnabled\(['"]list-member-filter['"]\)/);
  });

  it('loads MAIN-world runtime after gate/rate-filter and before content.js', () => {
    const main = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
    expect(main).toBeTruthy();
    const order = main.js;
    const gIdx = order.indexOf('src/premium/license/gate.js');
    const rfIdx = order.indexOf('src/premium/rate-filter/filter.js');
    const lfIdx = order.indexOf('src/premium/list-member-filter/filter.js');
    const cIdx = order.indexOf('content.js');
    expect(lfIdx).toBeGreaterThan(gIdx);
    expect(lfIdx).toBeGreaterThan(rfIdx);
    expect(lfIdx).toBeLessThan(cIdx);
  });

  it('uses an independent storage key, message bus, and hide marker', () => {
    expect(filter).toMatch(/STORAGE_KEY\s*=\s*['"]xvm_list_member_filter_v1['"]/);
    expect(filter).toMatch(/HIDE_ATTR\s*=\s*['"]data-xvm-list-member-hidden['"]/);
    expect(filter).toMatch(/XVM_LIST_MEMBER_FILTER_REQUEST/);
    expect(filter).toMatch(/XVM_LIST_MEMBER_FILTER_UPDATE/);
    expect(bridge).toMatch(/XVM_LIST_MEMBER_FILTER_REQUEST/);
    expect(bridge).not.toMatch(/XVM_LIST_MEMBER_FILTER_SET/);
    expect(bridge).toMatch(/xvm_list_member_filter_v1/);
  });

  it('pins cache contract fields for list metadata, members, ttl, and lastError', () => {
    for (const token of ['listId', 'url', 'name', 'screenName', 'members', 'userId', 'fetchedAt', 'ttlMs', 'lastError']) {
      expect(filter, `filter.js must preserve ${token}`).toMatch(new RegExp(`\\b${token}\\b`));
    }
  });

  it('filters current tweets by reply/tweet author from status links', () => {
    expect(filter).toMatch(/articleAuthor/);
    expect(filter).toMatch(/querySelectorAll\?\.\(['"]a\[href\*="\/status\/"\]['"]\)/);
    expect(filter).toMatch(/href\.match\(\s*\/\^\\\/\(\[\^\/\?#\]\+\)\\\/status\\\/\\d\+/);
    expect(filter).toMatch(/members\.handles\.has\(handle\)/);
  });

  it('hides the cellInnerDiv ancestor and restores only when no other XVM marker remains', () => {
    expect(filter).toMatch(/closest\(['"]\[data-testid="cellInnerDiv"\]['"]\)/);
    expect(filter).not.toMatch(/art\.style\.display\s*=\s*['"]none['"]/);
    expect(filter).toMatch(/querySelectorAll\(`article\[\$\{HIDE_ATTR\}\]`\)/);
    expect(filter).toMatch(/removeAttribute\(HIDE_ATTR\)/);
    expect(filter).toMatch(/OTHER_HIDE_ATTRS\s*=\s*\[['"]data-xvm-rate-hidden['"]\]/);
    expect(filter).toMatch(/hasOtherXvmHideMarker/);
    expect(filter).toMatch(/restoreCellIfNoOtherXvmMarker/);
    expect(filter).toMatch(/if\s*\(\s*!\s*hasOtherXvmHideMarker\(art\)\s*\)\s*cell\.style\.display\s*=\s*['"]['"]/);
  });

  it('keeps scope hooks for Home/List/Profile/Status detail', () => {
    expect(filter).toMatch(/getScopeFromPath/);
    expect(filter).toMatch(/scopes:\s*\{\s*home:\s*false,\s*list:\s*false,\s*profile:\s*false,\s*status:\s*true\s*\}/);
    expect(bridge).toMatch(/scopes:\s*\{\s*home:\s*false,\s*list:\s*false,\s*profile:\s*false,\s*status:\s*true\s*\}/);
    expect(filter).toMatch(/\/\^\\\/i\\\/lists\\\//);
    expect(filter).toMatch(/\/\^\\\/\[\^\/\]\+\\\/status\\\/\\d\+/);
  });

  it('runtime revokes on feature OFF, no members, scope mismatch, or tier downgrade', () => {
    expect(filter).toMatch(/!\s*gateOpen\(\)\s*\|\|\s*!\s*SETTINGS\.enabled\s*\|\|\s*!\s*scopeAllowed\(\)/);
    expect(filter).toMatch(/!\s*members\.handles\.size\s*&&\s*!\s*members\.userIds\.size/);
    expect(filter).toMatch(/__xvmPro\?\.onTierChange\?\./);
    expect(filter).toMatch(/revoke\(\)/);
  });

  it('bridge live-syncs chrome.storage.local changes into MAIN world', () => {
    expect(bridge).toMatch(/areaName\s*===\s*['"]local['"]/);
    expect(bridge).toMatch(/changes\.xvm_list_member_filter_v1/);
    expect(bridge).toMatch(/XVM_LIST_MEMBER_FILTER_UPDATE/);
  });

  it('does not expose a page postMessage path that writes list-member storage', () => {
    expect(bridge).not.toMatch(/XVM_LIST_MEMBER_FILTER_SET/);
    expect(bridge).not.toMatch(/event\.data\.settings/);
    expect(bridge).toMatch(/event\.isTrusted/);
    expect(bridge).toMatch(/writeListMemberEnabledFromInput/);
    expect(bridge).toMatch(/addEventListener\(['"]change['"]/);
    expect(bridge).toMatch(/closest\?\.\(['"]\.xvm-lb-list-member['"]\)/);
    expect(bridge).toMatch(/\.xvm-lb-list-member input\[type="checkbox"\]/);
  });

  it('adds a popup Filter-tab entry without touching the leaderboard top', () => {
    const filterPanel = html.match(/data-tab-panel="filter"[\s\S]*?(?=<\/section>)/)?.[0] || '';
    const leaderboardPanel = html.match(/data-tab-panel="leaderboard"[\s\S]*?(?=<section role="tabpanel")/)?.[0] || '';
    expect(filterPanel).toMatch(/id="list-member-filter-section"/);
    expect(leaderboardPanel).not.toMatch(/list-member-filter-section|lf-/);
    expect(html).toMatch(/src\/premium\/list-member-filter\/member-source\.js/);
    expect(html).toMatch(/src\/premium\/list-member-filter\/popup-list-member-filter\.js/);
  });

  it('popup owns list-member storage, parses URL/listId input, and uses Pro lock', () => {
    expect(popup).toMatch(/STORAGE_KEY\s*=\s*['"]xvm_list_member_filter_v1['"]/);
    expect(popup).toMatch(/parseListInput/);
    expect(popup).toContain('x\\.com|twitter\\.com');
    expect(popup).toContain('/i\\/lists\\/');
    expect(popup).toMatch(/__xvmTierLogic/);
    expect(popup).toMatch(/tier\s*===\s*['"]free['"]/);
    expect(popup).toMatch(/chrome\.storage\.local\.set/);
  });

  it('member-source implements live ListMembers GraphQL with Codex-captured queryId and features', () => {
    expect(source).toMatch(/QUERY_ID\s*=\s*\{[\s\S]*ListMembers:\s*['"]l90-8FD7I3dxXqJfyxSEeA['"]/);
    expect(source).toMatch(/ListByRestId:\s*['"]t9AbdyHaJVfjL9jsODwgpQ['"]/);
    expect(source).toMatch(/ListLatestTweetsTimeline:\s*['"]7UuJsFvnWuZo0HmxrzU42Q['"]/);
    expect(source).toMatch(/buildListMembersUrl/);
    expect(source).toMatch(/buildListMetadataUrl/);
    expect(source).toMatch(/\/ListByRestId\?/);
    expect(source).toMatch(/\/ListMembers\?/);
    expect(source).not.toMatch(/fieldToggles/);
    for (const flag of [
      'responsive_web_graphql_timeline_navigation_enabled',
      'view_counts_everywhere_api_enabled',
      'post_ctas_fetch_enabled',
      'responsive_web_enhance_cards_enabled',
    ]) {
      expect(source).toContain(flag);
    }
    expect(source).toMatch(/LIST_METADATA_FEATURES/);
    expect(source).toContain('verified_phone_label_enabled');
  });

  it('member-source parses the ListMembers response path and user fields from bb-browser evidence', () => {
    expect(source).toMatch(/data\?\.data\?\.list\?\.members_timeline\?\.timeline\?\.instructions/);
    expect(source).toMatch(/data\?\.data\?\.list_members_timeline\?\.timeline\?\.instructions/);
    expect(source).toMatch(/user_results/);
    expect(source).toMatch(/rest_id/);
    expect(source).toMatch(/core\.screen_name/);
    expect(source).toMatch(/core\.name/);
    expect(source).toMatch(/parseListMetadata/);
    expect(source).toMatch(/parseListByRestIdMetadata/);
    expect(source).toMatch(/ownerName/);
    expect(source).toMatch(/description/);
    expect(source).toMatch(/subscriberCount/);
    expect(source).toMatch(/member_count|members_count/);
    expect(source).toMatch(/Do not deep-walk members_timeline/);
    expect(source).toMatch(/name:\s*metadata\.name\s*\|\|\s*`List \$\{listId\}`/);
    expect(source).toMatch(/screenName:\s*metadata\.screenName\s*\|\|\s*['"]['"]/);
    expect(source).not.toMatch(/name:\s*metadata\.name\s*\|\|\s*input\?\.name/);
    expect(source).toMatch(/expectedMemberCount/);
    expect(source).toMatch(/cursorType/);
  });

  it('fetches members through an extension-owned storage request queue, not page postMessage SET', () => {
    expect(source).toMatch(/REQUEST_KEY\s*=\s*['"]xvm_list_member_fetch_request_v1['"]/);
    expect(source).toMatch(/RESPONSE_KEY\s*=\s*['"]xvm_list_member_fetch_response_v1['"]/);
    expect(source).toMatch(/responseKey\s*=\s*`\$\{RESPONSE_KEY\}_\$\{requestId\}`/);
    expect(source).toMatch(/requestGraphQL/);
    expect(source).toMatch(/chrome\.storage\.local\.set/);
    expect(bridge).toMatch(/LIST_MEMBER_FETCH_REQUEST_KEY\s*=\s*['"]xvm_list_member_fetch_request_v1['"]/);
    expect(bridge).toMatch(/LIST_MEMBER_FETCH_RESPONSE_KEY\s*=\s*['"]xvm_list_member_fetch_response_v1['"]/);
    expect(bridge).toMatch(/ListByRestId/);
    expect(bridge).toMatch(/credentials:\s*['"]include['"]/);
    expect(bridge).toMatch(/x-csrf-token/);
    expect(bridge).toMatch(/Bearer/);
    expect(bridge).not.toMatch(/XVM_LIST_MEMBER_FILTER_SET/);
  });

  it('popup add/refresh/delete workflow stores real members and blocks empty enable', () => {
    expect(popup).toMatch(/__xvmListMemberSource/);
    expect(popup).toMatch(/fetchListMembers/);
    expect(popup).toMatch(/fetchStatus:\s*['"]ready['"]/);
    expect(popup).toMatch(/data-action="refresh"|dataset\.action\s*=\s*['"]refresh['"]/);
    expect(popup).toMatch(/data-action="delete"|dataset\.action\s*=\s*['"]delete['"]/);
    expect(popup).toMatch(/hasReadyMembers/);
    expect(popup).toMatch(/settings\.enabled\s*=\s*false/);
    expect(popup).toMatch(/readScopes/);
    expect(popup).toMatch(/writeScopes/);
    expect(popup).toMatch(/lf-scope-status/);
    expect(popup).toMatch(/maxLists:\s*5/);
    expect(popup).toMatch(/maxMembersPerList:\s*5000/);
    expect(popup).toMatch(/maxMembersTotal:\s*10000/);
  });

  it('popup enforces capacity before append, excludes stale members, and serializes fetch UI', () => {
    expect(popup).toMatch(/duplicate\s*<\s*0\s*&&\s*settings\.lists\.length\s*>=\s*LIMITS\.maxLists/);
    expect(popup).toMatch(/setMessage\(section,\s*t\(['"]lfLimitLists['"]/);
    expect(popup).toMatch(/isListStale/);
    expect(popup).toMatch(/now\s*-\s*list\.fetchedAt\s*>\s*ttlMs/);
    expect(popup).toMatch(/l\.enabled\s*!==\s*false\s*&&\s*!\s*isListStale\(l\)/);
    expect(popup).toMatch(/lfStale/);
    expect(popup).toMatch(/let\s+busy\s*=\s*false/);
    expect(popup).toMatch(/setBusy\(section,\s*true\)/);
    expect(popup).toMatch(/setBusy\(section,\s*false\)/);
  });

  it('popup renders list owner/member table details, unique summary, and visible fetch progress', () => {
    expect(popup).toMatch(/uniqueMemberCount/);
    expect(popup).toMatch(/lf-summary/);
    expect(popup).toMatch(/lfOwner/);
    expect(popup).toMatch(/ownerName/);
    expect(popup).toMatch(/description/);
    expect(popup).toMatch(/subscriberCount/);
    expect(popup).toMatch(/name:\s*result\.name\s*\|\|\s*`List \$\{result\.listId \|\| parsed\.listId\}`/);
    expect(popup).toMatch(/screenName:\s*result\.screenName\s*\|\|\s*['"]['"]/);
    expect(popup).not.toMatch(/name:\s*result\.name\s*\|\|\s*parsed\.name/);
    expect(popup).toMatch(/lfMemberCount/);
    expect(popup).toMatch(/lfFetchedAt/);
    expect(popup).toMatch(/lfFetchDuration/);
    expect(popup).toMatch(/setProgress/);
    expect(popup).toMatch(/lf-progress/);
    expect(popup).toMatch(/lf-progress-bar/);
    expect(popup).toMatch(/lfLimitLabel/);
    expect(popup).toMatch(/lfFetchingLong/);
    expect(popup).toMatch(/onProgress/);
    expect(popup).toMatch(/classifyErrorMessage/);
    expect(popup).toMatch(/lfErrOpenX|lfErrAuth|lfErrRateLimit|lfErrPrivate/);
  });

  it('popup i18n keys exist in all shipped locales', () => {
    const keys = [
      'lfTitle', 'lfLockedHint', 'lfEnabled', 'lfInputLabel', 'lfAdd',
      'lfScopeLegend', 'lfScopeHome', 'lfScopeList', 'lfScopeProfile', 'lfScopeStatus',
      'lfCaptureHint', 'lfInvalidInput', 'lfAddedOk', 'lfMembers',
      'lfRefresh', 'lfDelete', 'lfFetching', 'lfFetchOk', 'lfFetchFailed',
      'lfFetchingLong', 'lfProgressIdle', 'lfProgressFetching', 'lfLimitLabel', 'lfFetchDone',
      'lfErrOpenX', 'lfErrAuth', 'lfErrRateLimit', 'lfErrPrivate',
      'lfSourceMissing', 'lfReady', 'lfStale', 'lfError', 'lfEmptyMembers',
      'lfDeletedOk', 'lfLimitLists', 'lfLimitMembers',
      'lfSummary', 'lfOwner', 'lfUnknownOwner', 'lfMemberCount', 'lfFetchedAt', 'lfFetchDuration',
    ];
    for (const locale of ['en', 'zh_CN', 'ja']) {
      const messages = JSON.parse(readFileSync(resolve(repo, `_locales/${locale}/messages.json`), 'utf8'));
      for (const key of keys) {
        expect(messages[key]?.message, `${locale} must include ${key}`).toBeTruthy();
      }
    }
  });
});
