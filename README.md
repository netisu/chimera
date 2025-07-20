# @netisu/chimera
![](https://img.shields.io/npm/types/typescript?style=for-the-badge)
<a href="https://adonisjs.com/">
<img src="https://img.shields.io/badge/%E2%96%B2%20adonis-v6-5a45ff?style=for-the-badge">
</a>
<a href="https://prettier.io/">
<img alt="code style: prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=for-the-badge">
</a>

Netisu presents.....
#  Chimera 🦁 🐍 🐐

Use your adonis named routes in your inertia frontend of choice.

## Installation

```shell
node ace add @netisu/chimera

node ace configure  @netisu/chimera
```

## Setup

### Register a Named Route

Create a named route in your start/routes.ts file:

```typescript
Route.get('users/:id', () => {
  ...
}).as('users.show');
```

## Client-Side Usage

### Getting the routes in your frontend

Compile your routes file by running

```shell
noce ace chimera:generate
```

By default it will export your routes at

`resources/js/chimera.ts`

but you can change this inside of the chimera config (at config/chimera.ts).

Now you can use the `Chimera` helper to access your adonis routes:

```typescript
import Chimera from 'resources/js/chimera';

Chimera.route('users.index'); // => `/users/1`

/**
 * You can also pass path params as an array and they will populated
 * according to their order:
 */
Chimera.route('users.show', { id: 1 }); // => `/users/1`
```

### Checking the Current Route

```typescript
import Chimera from 'resources/js/chimera';

Chimera.current('dashboard');
```
