# 02. Module auth — hashPassword, verifyPassword, generatePassword

## Contexte

Le projet utilise déjà `timingSafeEqual` de `node:crypto` dans `src/dashboard/server.ts`
pour la comparaison de tokens. Cette tâche crée un module dédié `src/core/auth.ts` qui
centralise toute la logique de hashing de mot de passe, en utilisant uniquement `node:crypto`
(zéro dépendance supplémentaire). Ce module sera utilisé par les routes auth (tâche 07) et
la commande CLI (tâche 16).

## Fichiers concernés

- `src/core/auth.ts` — créer (nouveau fichier)

## Implémentation détaillée

### Constantes

```typescript
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;        // N=2^14, recommandation OWASP
const SCRYPT_BLOCK_SIZE = 8;      // r
const SCRYPT_PARALLELIZATION = 1; // p
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Alphabet sans ambiguïté : pas de 0/O/1/l/I
const PASSWORD_LENGTH = 16;
```

### Imports

```typescript
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
```

### `hashPassword(password: string): Promise<string>`

1. Générer un salt de 16 bytes via `randomBytes(16)`
2. Appeler `scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION })`
3. Retourner `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`

Format de sortie : `scrypt:<salt_hex_32>:<hash_hex_128>`
- Le préfixe `scrypt:` permet de migrer vers un autre algo plus tard
- Salt de 16 bytes → 32 chars hex
- Hash de 64 bytes → 128 chars hex

### `verifyPassword(password: string, stored: string): Promise<boolean>`

1. Parser `stored` : split sur `:` → `[algo, saltHex, hashHex]`
2. Si `algo !== "scrypt"` → retourner `false`
3. Recalculer le hash avec le même salt
4. Comparer via `timingSafeEqual(Buffer.from(hashHex, "hex"), computedHash)`
5. Retourner le résultat booléen

**Important** : utiliser `timingSafeEqual` pour éviter les timing attacks. Si le format
est invalide, retourner `false` sans throw (gestion défensive).

### `generatePassword(): string`

1. Générer `PASSWORD_LENGTH` bytes aléatoires via `randomBytes(PASSWORD_LENGTH)`
2. Pour chaque byte, prendre `byte % PASSWORD_ALPHABET.length` comme index
3. Retourner la chaîne résultante

Entropie : ~95 bits (log2(57^16)). Suffisant pour un accès admin local.

### Exports

```typescript
export { hashPassword, verifyPassword, generatePassword };
```

## Critères de validation

- [ ] `pnpm typecheck` passe sans erreur
- [ ] `hashPassword("test")` retourne une string au format `scrypt:<32hex>:<128hex>`
- [ ] `verifyPassword("test", hash)` retourne `true` pour le hash correspondant
- [ ] `verifyPassword("wrong", hash)` retourne `false`
- [ ] `verifyPassword("test", "invalid-format")` retourne `false` sans throw
- [ ] `generatePassword()` retourne une string de 16 chars dans l'alphabet défini
- [ ] Aucun caractère ambigu (0, O, 1, l, I) dans le mot de passe généré

## Dépendances

- Tâche 01 doit être complétée avant (contexte DB, pas de dépendance directe de code)
