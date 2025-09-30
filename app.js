const { log, table, assert } = console;

const DECKOFCARDSAPI = 'https://deckofcardsapi.com';
const stockPileBackground =
    `url(${DECKOFCARDSAPI}/static/img/back.png) center / contain no-repeat`;
const refreshIconBackground =
    'url(https://imgs.search.brave.com/kioBYf-Ma3i45lfZ1Yu4FuJ6BUDSrVSjLgLtz-AU5I8/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90My5m/dGNkbi5uZXQvanBn/LzE0LzQyLzE2LzI0/LzM2MF9GXzE0NDIx/NjI0NDJfemMxNFBO/WXFac2EwaEQ0dkZO/WUFCNklJM2ZkZ25o/TzguanBn) center / contain no-repeat';
    
const allCards = [];
let allCardsSet = false;
let devMode = true;

let currentCard = null;

let logDrag = true;

// =========================================================================== //
// DOM ELEMENTS                                                               //
//___________________________________________________________________________//

const stockPileEl = document.querySelector('.stock');
const wastePileEl = document.querySelector(('.waste'));
const foundationEls = document.querySelectorAll('.foundation');
const tableauEls = document.querySelectorAll('.tableau');
const restartMenu = document.querySelector('.restart');

stockPileEl.style.background = stockPileBackground;

// =========================================================================== //
// DRAGGING LOGIC                                                             //
//___________________________________________________________________________//

const dragCard = (e, domCard, trailingCards) => {
    const x = (parseFloat(domCard.dataset.x) || 0) + e.dx;
    const y = (parseFloat(domCard.dataset.y) || 0) + e.dy;
    
    domCard.style.transform = `translate(${x}px, ${y}px)`;
    domCard.dataset.x = x;
    domCard.dataset.y = y;
    
    trailingCards.forEach((card, i) => {
        card.style.transform = `translate(${x}px, ${y}px)`;
        card.style.zIndex = String(i + 1000);
    });
}

const makeCardsDraggable = () => {
    interact('.card').draggable({
        pointerMoveTolerance: 10,
        listeners: {
            start(e) {
                const card = Card.fromDOM(e.target);
                if (!card) return;
                const { parent, _card: domCard } = card;
                let trailingCards;
                
                if (domCard === parent.lastElementChild) {
                    card.dragPromise = new Promise((res, rej) => {
                        card._resolve = (targetProxy, fromProxy) => {
                            res();
                            targetProxy.push(fromProxy.pop());
                            Card.cleanUpPromises(card);
                        }
                        card._reject = (fromProxy) => {
                            rej();
                            card.preventFlip = true;
                            fromProxy.push(fromProxy.pop());
                            Card.cleanUpPromises(card);
                        }
                    });
                } else {
                    trailingCards = [...parent.children].slice(
                        [...parent.children].indexOf(domCard) + 1
                    );
                    
                    card.dragPromise = new Promise((res, rej) => {
                        card._resolve = (targetProxy, fromProxy, activeIdx) => {
                            res();
                            targetProxy.push(...fromProxy.splice(activeIdx));
                            Card.cleanUpPromises(card);
                        }
                        card._reject = (fromProxy, activeIdx) => {
                            rej();
                            card.preventFlip = true;
                            fromProxy.push(...fromProxy.splice(activeIdx));
                            Card.cleanUpPromises(card);
                        }
                    });
                }
                domCard.classList.add('dragging');
                
                if (trailingCards) e.interaction.trailingCards = trailingCards;
                
                currentCard = new WeakRef(card);
            },
            move(e) {
                const domCard = e.target;
                const trailingCards = e.interaction.trailingCards || [];
                
                dragCard(e, domCard, trailingCards);
            },
            end(e) {
                const domCard = e.target;
                const card = Card.fromDOM(domCard);
                currentCard = new WeakRef(card);
                
                delete domCard.dataset.x;
                delete domCard.dataset.y;
                
                let { fromProxy, trailingCards, activeIdx } = card;
                if (fromProxy.active) fromProxy = fromProxy.active;
                
                if (trailingCards) {
                    card._reject(fromProxy, activeIdx);
                } else {
                    card._reject(fromProxy);
                }
            }
        }
    });
};

interact('.foundation').dropzone({
    accept: '.card',
    overlap: .25,
    ondrop(e) {
        const pile = e.target;
        const targetProxy = foundationProxies.get(pile);
        const card = Card.fromDOM(e.relatedTarget);
        let { fromProxy } = card;
        if (fromProxy.active) fromProxy = fromProxy.active;
        
        if (validFoundationMove(card, pile)) {
            card._resolve(targetProxy, fromProxy);
            return
        }
        card._reject(fromProxy);
    }
});

interact('.tableau').dropzone({
    accept: '.card',
    overlap: .25,
    ondrop(e) {
        const pile = e.target;
        let targetProxy = tableauProxies.get(pile);
        if (targetProxy.active) targetProxy = targetProxy.active;
        
        const card = Card.fromDOM(e.relatedTarget);
        let { fromProxy, activeIdx } = card;
        if (fromProxy.active) fromProxy = fromProxy.active;
        
        if (validTableauMove(card, pile)) {
            card._resolve(targetProxy, fromProxy, activeIdx);
            return
        }
        card._reject(fromProxy, activeIdx);
    }
});

// =========================================================================== //
// PILE ARRAYS AND  PROXIES                                                   //
//___________________________________________________________________________//

const stockCards = [];

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
                    interact(removed._card).unset();
                    removeFromWaste();
                    currentCard = null;
                }
                return removed;
            }
        }
        if (prop === 'sendBackToStock') {
            return () => {
                [...wastePileEl.children].forEach(domCard => {
                    interact(domCard).unset();
                });
                while (target.length) stockCards.push(target.pop());
                wastePileEl.innerHTML = '';
            }
        }
        return Reflect.get(target, prop, receiver);
    }
});

const makeFoundationProxy = (pile) => new Proxy([], {
    get(target, prop, receiver) {
        if (prop === 'push') {
            return (...cards) => {
                cards.forEach(card => {
                    addToFoundation(card, pile);
                    makeCardsDraggable();
                });
                if (gameFinished()) addRestartScreen();
                return Array.prototype.push.apply(target, cards);
            }
        }
        if (prop === 'pop') {
            return () => {
                const removed = Array.prototype.pop.call(target);
                if (removed) {
                    interact(removed._card).unset();
                    removeFromFoundation(pile);
                    currentCard = null;
                }
                return removed;
            }
        }
        return Reflect.get(target, prop, receiver);
    }
});

const foundationProxies = new Map();
[...foundationEls].forEach((el) => {
    foundationProxies.set(el, makeFoundationProxy(el));
});

const makeActiveProxy = (pile) => new Proxy([], {
    get(target, prop, receiver) {
        if (prop === 'push') {
            return (...cards) => {
                if (cards.length === 1) {
                    addCardToTableau(cards[0], pile);
                    makeCardsDraggable();
                    return Array.prototype.push.apply(target, cards);
                }
                addStackToTableau(cards, pile);
                makeCardsDraggable();
                return Array.prototype.push.apply(target, cards);
            }
        }
        if (prop === 'pop') {
            return () => {
                const removed = Array.prototype.pop.call(target);
                if (removed) {
                    interact(removed._card).unset();
                    removeCardFromTableau(pile);
                    currentCard = null;
                }
                return removed;
            }
        }
        if (prop === 'splice') {
            return (activeIdx) => {
                const stack = Array.prototype.splice.call(target, activeIdx);
                if (stack.length) {
                    removeStackFromTableau(activeIdx, pile);
                    currentCard = null;
                }
                return stack;
            }
        }
        return Reflect.get(target, prop, receiver);
    }
});
const makeInactiveProxy = (pile) => new Proxy([], {
    get(target, prop, receiver) {
        if (prop === 'map') {
            return (...cards) => Array.prototype.map.apply(target, cards);
        }
        if (prop === 'forEach') {
            return (...cards) => Array.prototype.forEach.apply(target, cards);
        }
        if (prop === 'pop') {
            return () => {
                const removed = Array.prototype.pop.call(target);
                if (removed) {
                    interact(removed._card).unset();
                    removeFromInactive(pile);
                    currentCard = null;
                }
                return removed;
            }
        }
        if (typeof prop === 'symbol' || prop === 'length') {
            return Reflect.get(target, prop, receiver);
        }
        if (allCardsSet) return undefined;
        
        return Reflect.get(target, prop, receiver);
    }
});
const combineTableauProxies = (pile) => {
    return { active: makeActiveProxy(pile), inactive: makeInactiveProxy(pile) };
}

const tableauProxies = new Map();
[...tableauEls].forEach((el) => {
    tableauProxies.set(el, combineTableauProxies(el));
});

const allProxies = new Map();
allProxies.set(wastePileEl, wasteProxy);
[...foundationEls].forEach((el) => {
    allProxies.set(el, foundationProxies.get(el));
});
[...tableauEls].forEach((el) => {
    allProxies.set(el, tableauProxies.get(el));
});

// =========================================================================== //
// LOGGING FUNCTIONS                                                          //
//___________________________________________________________________________//

const logFoundationsTable = () => {
    const foundationsTable = {};
    for (const [i, [, proxy]] of [...foundationProxies].entries()) {
        foundationsTable[i + 1] = String(proxy.map(c => c.code));
    }
    table(foundationsTable);
}

const logTableauTable = () => {
    const tableauTables = {};
    for (const [i, [, { active, inactive }]] of [...tableauProxies].entries()) {
        tableauTables[i + 1] = {
            active: String(active.map(c => c.code)),
            inactive: String(inactive.map(c => c.code))
        }
    }
    table(tableauTables);
}

// =========================================================================== //
// CARD CLASS AND LOGIC                                                       //
//___________________________________________________________________________//

class Card {
    static codeMap = {};
    
    static fromDOM(domCard) {
        return Card.codeMap[domCard.dataset.code];
    }
    
    static cleanUpPromises(card) {
        card.preventFlip = null;
    }
    
    constructor(suit, val, img, code) {
        this.suit = suit.toLowerCase();
        this.color = (this.suit === 'diamonds' || this.suit === 'hearts')
            ? 'red' : 'black';
        this.value = isNaN(Number(val))
            ? (val === 'KING' ? 13 : val === 'QUEEN' ? 12
            : val === 'JACK' ? 11 : 'ACE' ? 1 : null)
            : Number(val);
        this.face = img;
        this.back = `${DECKOFCARDSAPI}/static/img/back.png`;
        this.code = code;
    }
    
    _createCardBase() {
        const img = document.createElement('img');
        img.alt = '';
        img.ariaHidden = true;
        img.classList.add('card');
        Object.assign(img.dataset, {
            face: this.face, suit: this.suit, color: this.color,
            value: this.value, code: this.code,
        });
        return img;
    }
    
    _createActive(pile, { realPile } = {}) {
        const card = this._createCardBase();
        card.src = this.face;
        this.parent = realPile ?? pile;
        this._card = card;
        this.fromProxy = allProxies.get(realPile ?? pile);
        Card.codeMap[this.code] = this;
        card.addEventListener('click', () => {
            makeLegalMove(this);
        });
        return card;
    }
    
    _createInactive(pile, { realPile } = {}) {
        const card = this._createCardBase();
        card.src = this.back;
        this.parent = realPile ?? pile;
        this._card = card;
        this.fromProxy = allProxies.get(realPile ?? pile);
        card.style.pointerEvents = 'none';
        card.setAttribute('inactive', '');
        return card;
    }
    
    appendCardTo(pile, { realPile } = {}) {
        const card = this._createActive(pile, { realPile });
        pile.appendChild(this._card);
    }
    
    insertCardBefore(pile, target, { realPile } = {}) {
        const card = this._createActive(pile, { realPile });
        pile.insertBefore(card, target);
    }
    
    appendInactiveTo(pile, { realPile } = {}) {
        const card = this._createInactive(pile, { realPile });
        pile.appendChild(card);
    }
}

// =========================================================================== //
// GAME STATE HANDLERS                                                        //
//___________________________________________________________________________//

const drawCard = () => {
    if (!stockCards.length && !wasteProxy.length) return;
    
    if (!stockCards.length) {
        wasteProxy.sendBackToStock();
        stockPileEl.style.background = stockPileBackground;
        return;
    }
    
    if (stockCards.length === 1) {
        stockPileEl.style.background = refreshIconBackground;
    }
    
    wasteProxy.push(stockCards.pop());
}
stockPileEl.addEventListener('click', drawCard);

const makeLegalMove = (card) => {
    const { parent, fromProxy } = card;
    
    if (parent === wastePileEl) {
        for (const [el, proxy] of foundationProxies) {
            if (validFoundationMove(card, el)) {
                proxy.push(fromProxy.pop()); return;
            }
        }
        
        for (const [el, { active: proxy }] of tableauProxies) {
            if (validTableauMove(card, el)) {
                proxy.push(fromProxy.pop()); return;
            }
        }
    }
    
    if (foundationProxies.get(parent)) {
        for (const [el, { active: proxy }] of tableauProxies) {
            if (validTableauMove(card, el)) {
                proxy.push(fromProxy.pop()); return;
            }
        }
    }
    if (tableauProxies.get(parent)) {
        const { active: fromActive } = fromProxy;
        
        if (card.activeIdx === fromActive.length - 1) {
            for (const [el, proxy] of foundationProxies) {
                if (validFoundationMove(card, el)) {
                    proxy.push(fromActive.pop()); return;
                }
            }
            
            for (const [el, { active: proxy }] of tableauProxies) {
                if (validTableauMove(card, el)) {
                    proxy.push(fromActive.pop()); return;
                }
            }
        }
        
        for (const [el, { active: proxy }] of tableauProxies) {
            if (validTableauMove(card, el)) {
                proxy.push(...fromActive.splice(card.activeIdx)); return;
            }
        }
    }
};

const gameFinished = () => {
    for (const pile of [...foundationEls]) {
        if (!pile.hasAttribute('finished')) {
            return false;
        }
    }
    return true;
}

const addRestartScreen = () => {
    const button = document.querySelector('.restart .button');
    button.addEventListener('click', () => window.location.reload());
    document.querySelector('.container').replaceWith(restartMenu);
    restartMenu.show();
}

// =========================================================================== //
// WASTE PILE LOGIC                                                           //
//___________________________________________________________________________//

const addToWaste = (card) => {
    if (wastePileEl.childElementCount === 2) {
        wastePileEl.firstElementChild.remove();
    }
    card.appendCardTo(wastePileEl);
}

const removeFromWaste = () => {
    wastePileEl.lastElementChild.remove();
    
    const prevBottom = wasteProxy.at(-2);
    if (prevBottom) prevBottom.insertCardBefore(
        wastePileEl, wastePileEl.firstElementChild,
    );
}

// =========================================================================== //
// FOUNDATION PILE LOGIC                                                      //
//___________________________________________________________________________//

const validFoundationMove = (card, pile) => {
    const { suit, value } = card;
    
    if (!pile.childElementCount && value === 1) {
        return true;
    }
    if (!pile.childElementCount) return false;
    
    const { suit: pileSuit } = pile.dataset;
    const endCard = foundationProxies.get(pile).at(-1);
    const { value: endValue } = endCard;
    
    return (suit === pileSuit && value === endValue + 1);
}

const addToFoundation = (card, pile) => {
    const { suit, value } = card;
    if (!pile.childElementCount) {
        pile.dataset.suit = suit;
    }
    
    if (pile.childElementCount === 2) {
        pile.firstElementChild.remove();
    }
    
    if (value === 13) pile.setAttribute('finished', '');
    
    card.appendCardTo(pile);
}

const removeFromFoundation = (pile) => {
    const proxy = foundationProxies.get(pile);
    const prevBottom = proxy.at(-2);
    
    pile.lastElementChild.remove();
    
    if (prevBottom) prevBottom.insertCardBefore(
        pile, pile.lastElementChild,
    );
    
    if (!pile.childElementCount) {
        delete pile.dataset.suit;
    }
    
    if (pile.hasAttribute('finished')) {
        pile.removeAttribute('finished');
    }
}

// =========================================================================== //
// TABLEAU PILE LOGIC                                                         //
//___________________________________________________________________________//

const validTableauMove = (card, pile) => {
    if (!allCardsSet) return true;
    
    const { color, value } = card;
    const targetProxy = tableauProxies.get(pile);
    
    if (!pile.childElementCount && value === 13) {
        return true;
    }
    if (!pile.childElementCount) return false;
    
    const endCard = targetProxy.active.at(-1);
    const { color: endColor, value: endValue } = endCard;
    
    return (color !== endColor && value === endValue - 1);
}

const addCardToTableau = (card, pile) => {
    if (!allCardsSet) return;
    
    card.appendCardTo(pile);
    resetTableau(pile);
}

const removeCardFromTableau = (pile) => {
    const proxy = tableauProxies.get(pile);
    const { active, inactive } = proxy;
    
    pile.lastElementChild.remove();
    
    if (!active.length && inactive.length) {
        flipInactiveCard(pile, proxy);
    }
    resetTableau(pile);
}

const addStackToTableau = (stack, pile) => {
    const cards = document.createDocumentFragment();
    stack.forEach(card => card.appendCardTo(
        cards, { realPile: pile }
    ));
    pile.appendChild(cards);
    resetTableau(pile);
}

const removeStackFromTableau = (activeIdx, pile) => {
    const { active, inactive } = tableauProxies.get(pile);
    const keep = document.createDocumentFragment();
    
    inactive.forEach(c => c.appendInactiveTo(keep, { realPile: pile }));
    
    for (let i = 0; i < activeIdx; i++) {
        active[i].appendCardTo(keep, { realPile: pile });
    }
    
    pile.replaceChildren(keep);
    
    if (!active.length && inactive.length) {
        flipInactiveCard(pile, tableauProxies.get(pile));
    }
    resetTableau(pile);
}

const removeFromInactive = (pile) => {
    pile.lastElementChild?.remove();
    resetTableau(pile);
}

// =========================================== //
//  TABLEAU HELPERS                           //
//___________________________________________//

const flipInactiveCard = (pile, proxy) => {
    if (currentCard?.deref()?.preventFlip) return;
    const { active, inactive } = proxy;
    active.push(inactive.pop());
    resetTableau(pile);
}

const updateActiveIdx = (domCard, activeIdx) => {
    const card = Card.fromDOM(domCard);
    if (card) card.activeIdx = activeIdx;
}

const resetTableauStyles = (domCard, i) => {
    Object.assign(domCard.style, {
        top: `${i * 25}px`,
        zIndex: String(i + 1)
    });
}

const initTableau = (pile) => {
    const domCards = [...pile.children];
    let activeIdx = 0;
    domCards.forEach((card, i) => {
        if (!card.hasAttribute('inactive')) {
            updateActiveIdx(card, activeIdx);
            activeIdx++;
        }
        resetTableauStyles(card, i);
    });
    pile.style.paddingBottom =
        `${(Math.max(0, domCards.length - 1) * 25)}px`;
}

const resetTableau = (pile) => initTableau(pile);

// =========================================================================== //
// API LOGIC                                                                  //
//___________________________________________________________________________//

(async () => {
    const { data } = await axios.get(
        `${DECKOFCARDSAPI}/api/deck/new/draw/?count=52`
    );
    const { cards } = data;
    cards.forEach(c => stockCards.push(new Card(
        c.suit, c.value, c.image, c.code
    )));
    const tableauCards = stockCards.splice(0, 28);
    
    [0, 1, 2, 3, 4, 5, 6].forEach(i => {
        const pile = tableauEls[i];
        const proxy = tableauProxies.get(pile);
        
        for (let j = 0; j < i; j++) {
            const card = tableauCards.pop();
            proxy.inactive.push(card);
            card.appendInactiveTo(pile);
        }
        const face = tableauCards.pop();
        proxy.active.push(face);
        face.appendCardTo(pile);
        
        initTableau(pile);
    });
    allCardsSet = true;
    makeCardsDraggable();
})();