# Solitaire

This project utilizes several programming strategies to create a workable game of solitaire on the browser.

- [APIs](#apis---httpsdeckofcardsapicom)
- [Object Oriented Programming](#object-oriented-programming-oop)
- [Interact.js](#third-party-libraries---interactjs)
- [Proxies](#reactivity-through-proxy-objects)
- [Event Validations](#event-validations)
- [Summary](#summary)

## APIs - `https://deckofcardsapi.com` 

In order to get a full deck of shuffled cards, a request is made to the API:

```js
async () => {
    const { data } = await axios.get(`${DECKOFCARDSAPI}/api/deck/new/draw/?count=52`);
    const { cards } = data;
}
```

[back to top](#solitaire)

## Object Oriented Programming (OOP)

A `Card` class is used to convert the data for each card into a workable object with data that can be used to track and update its relationship to the game state: 

To place cards into appropriate piles, the colors, suits, and values need to be taken into account. Exceptions in game state logic need to be made for inactive (face down) cards. As cards are moved, the cards themselves, as well as the starting and target piles, need to track the game state to either change, or not change depending on the move's legality. Each Card instance needs to have a corresponding DOM element. All of these requirements are handled through Card properties and methods.

```js
class Card {
    constructor(suit, val, img, code) {
        ...
    }
    
    appendCardTo(pile { realPile } = {}) {
        ...
    }
    
    appendInactiveTo(pile { realPile } = {}) {
        ...
    }
    
    static fromDOM(domCard) {
        ...
    }
}
```

[back to top](#solitaire)

## Third-Party Libraries - Interact.js

To make the cards draggable, I am utilizing the `interact.js` library, which helps streamline dragging events. designating both what cards can be dragged, the limits on the dragging logic, and where the elements can be dragged into (dropzones):

```js
interact('.foundation').dropzone({
    accept: '.card',
    ondrop(e) {
        // use Card instance data to determine if the card being drapped into the pile
        //  is a legal move
    }
});

interact('.tableau').dropzone({
    accept: '.card',
    ondrop(e) {
        // use Card instance data to determine if the card, or stack of cards, being dragged into
        //  the pile is a legal move
    }
});

const makeCardsDraggable = () => {
    // Because .card elements are created and destroyed regularly, the event listener needs to be
    //  regularly updated via a callable function
    interact('.card').draggable({
        listeners: {
            start(e) {
                // initialize the dragging event by bookmarking metadata, which will determine if
                //  a move is legal or not
            },
            move(e) {
                // update the coordinates of the .card, or stack of .card elements, in real time
                //  with the user's cursor
            },
            end(e) {
                // If the dropzone does not accept the .card, or the .card is dragged into
                //  anywhere except for a dropzone, the drop is rejected and the .card snaps
                //  back to the original pile
            }
        }
    });
}
```

[back to top](#solitaire)

## Reactivity through Proxy Objects

Rather than always keeping 52 card elements in the DOM, especially when the majority of them will not be visible anyway, the DOM cards are regularly deleted and appened to the piles. For example, the foundation and waste piles only show one card at any given time, so it's unnecessary to have 13 or more DOM cards in those piles. Instead, we only need the top card, and one additional bottom card (so the pile is not empty when the top card is dragged away). However, this does not match the game state, where there will consistently be 10 or more cards in the pile.

To account for this, there are lists for each pile that act as the source of truth for the game state. Regardless of what the DOM says, those lists are the accurate representation of which cards are in what pile, and the functions that update the game state revolve around updating those lists rather than mutating the DOM. But to make sure the DOM is also an accurate representation of the game state, the each list is wrapped in a `Proxy`.

```js
const wasteProxy = new Proxy([], {
    get(target, prop, receiver) {
        if (prop === 'push') {
            return (...cards) => {
                cards.forEach(card => {
                    addToWaste(card);
                    makeCardsDraggable();
                });
                return Array.prototype.push.apply(target, cards);
            }
        }
        if (prop === 'pop') {
            return () => {
                const removed = Array.prototype.pop.call(target);
                if (removed) {
                    // ._card is the DOM card tied to the instance
                    interact(removed._card).unset();
                    removeFromWaste();
                }
            }
        }
        return Reflect.get(target, prop, target);
    }
});

const addToWaste = (card) => {
    // 1. Take in a Card instance and create a DOM card from it
    // 2. If there are already two DOM cards, remove the first one (the bottom card),
    //  and place the new card on top of the pile.
}

const removeFromWaste = () => {
    // 1. Remove the current top card, making the bottom card the new top
    // 2. If there was more than one Card in the proxy, the pile needs a new bottom card as well, 
    //  represented by wasteProxy.at(-2)
    // 3. That new DOM card needs to be added before the top DOM card, so it's visible when the
    //  top card is removed
}
```

To make the waste pile intuitively update for the user, while still never exceeding two DOM cards at any given time, DOM cards need to constantly be created and destroyed, and strategically placed in the pile. Instead of tracking that manually, the actions are tied to a proxy, so the when the data is mutated, those array methods are trapped, updating the DOM in real time. 

Each trap is indifferent to where the Card instance came from, or where it's going, it merely handled adding or removing a Card, so they can be chained together in any order.


```js
const makeFoundationProxy = (pile) => new Proxy([], {
    get(target, prop, receiver) {
        if (prop === 'push') {
            ...
        }
        if (prop === 'pop') {
            ...
        }
    }
});

// Foundation and tableau proxies are mapped by their corresponding DOM piles
const pile = foundationEls[0];
foundationProxies.get(pile).push(wasteProxy.pop());
```

Here, the logic for `foundationProxy.push()` and `wasteProxy.pop()` are completely independent, as the `push` only adds a card and the `pop` only removes one. But since they're called together, a DOM card is removed the from waste pile, and added to the first foundation pile simultaneously. The proxies themselves are updated as the source of truth, and the DOM follows.

[back to top](#solitaire)

## Event Validations

On their own, `targetProxy.push(fromProxy.pop())` commands don't care about the game state, and will allow any card to be pushed from any pile into any other pile. In order to gameify the events, rules have to be implemented to constrain what cards can be moved, and where.

```js
const validFoundationMove = (card, pile) => {
    // 1. Check if the card is an Ace and if the pile is empty, return "true"
    // 2. Check if the pile is empty, return "false"
    // 3. Return whether the card is the right suit and the value of the card is one more than the 
    //  current top of the pile
}

const validTableauMove = (card, pile) => {
    // 1. As the cards are added to the tableaus before the game even starts, I don't want to
    //  reject any incoming cards until the setup is complete. Until all cards are in place,
    //  return "true"
    // 2. Check if the pile is empty and the card is a King, return "true"
    // 3. Check if the pile is empty, return "false"
    // 4. Return whether the card is a different color and the value is one less than the
    //  current top card
}
```

When a DOM card is moved into a pile, that Card instance and that pile are compared to see if the move is legal. If so, the transfer is made to the two proxies, if not, the transfer is rejected.

```js
const makeLegalMove = (card) => {
    const { parent, fromProxy } = card;
    
    if (parent === wasteProxy) {
        // From the waste pile, check for available moves in the foundations first,
        //  then the tableaus
        for (const [el, proxy] of foundationProxies) {
            if (validFoundationMove(card, el)) {
                proxy.push(fromProxy.pop());
                return;
            }
        }
        for (const [el, { active: proxy }] of tableauProxies) {
            if (validTableauMove(card, el)) {
                proxy.push(fromProxy.pop());
                return;
            }
        }
    }
    
    // If the pile is one of the foundations, check the tableaus for a possible move
    if (foundationProxies.get(pile)) {
        for (const [el, { active: proxy }] of tableauProxies) {
            if (validTableauMove(card, el)) {
                proxy.push(fromProxy.pop());
                return;
            }
        }
    }
    
    // If the pile is a tableau, check if it's a single card vs a stack. Single cards check for a
    //  foundation move, then a tableau move. Stacks only check for a tableau move.
    if (tableauProxies.get(parent)) {
        // Tableau piles have separate proxies for active and inactive cards
        const { active: fromActive } = fromProxy;
        
        // Card instances are given an "activeIdx" property to distinguish between the index of
        //  the DOM cards and the index of the active cards.
        
        // This is used to determine if the user is moving a single card, or a stack of cards
        if (card.activeIdx === fromActive.length - 1) {
            for (const [el, proxy] of foundationProxies) {
                if (validFoundationMove(card, el)) {
                    proxy.push(fromActive.pop());
                    return;
                }
            }
            for (const [el, { active: proxy }] of tableauProxies) {
                if (validTableauMove(card, el)) {
                    proxy.push(fromActive.pop());
                    return;
                }
            }
        }
        for (const [el, { active: proxy }] of tableauProxies) {
            if (validTableauMove(card, el)) {
                proxy.push(...fromActive.splice(card.activeIdx));
                return;
            }
        }
    }
}
```

This search for a valid move is triggered by clicking the DOM card, set up when each Card is instantiated.

```js
class Card {
    ...
    
    _createActive(pile, { realPile } = {}) {
        ...
        card.addEventListener('click', () => {
            makeLegalMove(this);
        });
    }
}
```

For the dragging, the same general matching logic is used, but is instead wrapped in a `Promise`, initialized when the card is dragged and resolved or rejected when the card is set.

```js
interact('.card').draggable({
    listeners: {
        start(e) {
            ...
            // single card
            if (domCard === parent.lastElementChild) {
                card.dragPromise = new Promise((res, rej) => {
                    card._resolve = (targetProxy, fromProxy) => {
                        res();
                        targetProxy.push(fromProxy.pop());
                    }
                    card._reject = (fromProxy) => {
                        rej();
                        card.preventFlip = true;
                        fromProxy.push(fromProxy.pop());
                    }
                });
                // stack of cards
            } else {
                ...
                
                card.dragPromise = new Promise((res, rej) => {
                    card._resolve = (targetProxy, fromProxy, activeIdx) => {
                        res();
                        targetProxy.push(...fromProxy.splice(activeIdx));
                    }
                    card._reject = (fromProxy, activeIdx) => {
                        rej();
                        card.preventFlip = true;
                        fromProxy.push(...fromProxy.splice(activeIdx));
                    }
                });
            }
        }
    }
})
```

In `card._reject`, the cards are taken out of the initial pile, only to be put right back into that same pile. This is intentional, as part of the pile setting logic is a hard reset on the pile's styling.

```js
const resetTableau = (pile) => {
    const domCards = [...pile.children];
    let activeIdx = 0;
    domCards.forEach((card, i) => {
        if (!card.hasAttribute('inactive')) {
            updateActiveIdx(card, activeIdx);
            activeIdx++;
        }
        resetTableauStyles(card, i);
    });
}
```

When the cards are dragged, their coordinates and metadata are changed, so rather than manually resetting them, those DOM cards are just replaced, and if it was a tableau pile, its styles are immediately reset. Because the logic to flip over an inactive card at the top of a tableau is automated, a `preventFlip` flag is used to override this behavior in this edge case.

By default, releasing the DOM cards after dragging will reject the Promise, as there are only a few valid placements for any given card.

```js
interact('.card').draggable({
    listeners: {
        start(e) {
            let trailingCards;
            ...
            if (domCard === parent.lastElementChild) {
                ...
            } else {
                // If a stack of cards are being dragged, each card after the top card
                //  needs to be targeted
                trailingCards = [...parent.children].slice([...parent.children].indexOf(domCard));
            }
            ...
        },
        move(e) {
            ...
        },
        end(e) {
            ...
            if (trailingCards) {
                card._reject(fromProxy, activeIdx);
            } else {
                card._reject(fromProxy);
            }
        }
    }
});
```

But the foundations and tableaus are also designated dropzones, which handle game logic and resolve the Promise instead of rejecting if placing that card on that pile is a legal move.

```js
interact('.foundation').dropzone({
    ondrop(e) {
        ...
        if (validFoundationMove(card, pile)) {
            card._resolve(targetProxy, fromProxy);
            return;
        }
        card._reject(fromProxy);
    }
});

interact('.tableau').dropzone({
    ondrop(e) {
        ...
        if (validTableauMove(card, pile)) {
            card._resolve(targetProxy, fromProxy, activeIdx);
            return;
        }
        card._reject(fromProxy, activeIdx);
    }
});
```

So when a DOM card is dropped onto dropzone, it overrides the default `end()` rejections, allowing the dropzone to resolve the Promise instead, or reject the cards itself if the move is illegal.

[back to top](#solitaire)

## Summary

A shuffled deck of cards is fetched through an external API and converted into instances of a Card class, which are then binded to DOM elements and sorted into proxies. The proxies exist as the authoritative game state, with traps for `push`, `pop`, and `splice` to reactively update the DOM when the game state changes. Solitaire's rules are implemented in validation functions that determine if a card is allowed to be placed into a pile or not. The user can shortcut game moves by clicking a card to send it to the next legal pile, or drag the card into a pile using the interact.js library. 

The combination of Proxy and OOP allow the app to focus entirely on validating and transferring data, and have the DOM automatically catch up to any data mutations. Third party libraries allow the cards to be moved smoothly from pile to pile, and the Deck of Cards API prevents the need for server storage of the card data, while also allowing the deck to be shuffled in a new order on every page load.

[back to top](#solitaire)
