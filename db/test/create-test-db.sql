SELECT 'CREATE DATABASE tenantforge_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tenantforge_test')
\gexec
