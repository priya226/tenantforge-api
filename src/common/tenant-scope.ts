export type TenantScope =
  { kind: 'all' } | { kind: 'company'; companyId: string };

export const ALL_COMPANIES: TenantScope = { kind: 'all' };

/**
 * 
 * @param scope 
 * @param companyId 
 * @returns 
 * ┌───────────────────────────────────┬───────────────────────────┬────────┬───────────────────────────────────────────────────────────────────────┐
│          Caller's scope           │  companyId being asked    │ Result │                                  Why                                  │
│                                   │           about           │        │                                                                       │
├───────────────────────────────────┼───────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────┤
│ { kind: 'all' } (platform admin)  │ anything                  │ true   │ A platform admin sees every company.                                  │
├───────────────────────────────────┼───────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────┤
│ { kind: 'company', companyId: 'A' │ 'A'                       │ true   │ Their own company.                                                    │
│  }                                │                           │        │                                                                       │
├───────────────────────────────────┼───────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────┤
│ { kind: 'company', companyId: 'A' │ 'B'                       │ false  │ Another company.                                                      │
│  }                                │                           │        │                                                                       │
├───────────────────────────────────┼───────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────┤
│ { kind: 'company', companyId: 'A' │ null                      │ false  │ "No company" means platform-level data, which a company user must not │
│  }                                │                           │        │  see.                                                                 │
└───────────────────────────────────┴───────────────────────────┴────────┴───────────────────────────────────────────────────────────────────────┘
 */
export function inScope(scope: TenantScope, companyId: string | null): boolean {
  return scope.kind === 'all' || scope.companyId === companyId;
}
