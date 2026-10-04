import { describe,expect,it } from 'vitest';
import { allowedNavigationMutation } from './navigationSecurity';
describe('navigation CSRF boundary',()=>{
  it('allows same-origin browser writes with Origin or Fetch Metadata',()=>{expect(allowedNavigationMutation('https://basira.example','basira.example','same-origin')).toBe(true);expect(allowedNavigationMutation(undefined,'basira.example','same-origin')).toBe(true);});
  it('rejects cross-site, missing provenance and insecure origins even with session cookies',()=>{expect(allowedNavigationMutation('https://evil.example','basira.example','cross-site')).toBe(false);expect(allowedNavigationMutation('https://evil.example','basira.example',undefined)).toBe(false);expect(allowedNavigationMutation(undefined,'basira.example',undefined)).toBe(false);expect(allowedNavigationMutation('http://basira.example','basira.example','same-origin')).toBe(false);expect(allowedNavigationMutation('null','basira.example','same-origin')).toBe(false);});
});
