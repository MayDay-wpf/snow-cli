import type {CompanionBones, Eye, Hat, Species} from './types.js';
import {
	axolotl,
	blob,
	basketball,
	cactus,
	capybara,
	cat,
	chicken,
	chonk,
	dragon,
	duck,
	fox,
	ghost,
	goose,
	hamster,
	teapot,
	rocket,
	laptop,
	moon,
	cloud,
	lantern,
	treasure,
	book,
	star,
	coffee,
	snowman,
	mushroom,
	octopus,
	owl,
	panda,
	penguin,
	rabbit,
	raccoon,
	robot,
	snail,
	turtle,
	unicorn,
	whale,
} from './types.js';

export function speciesColor(species: Species): string {
	switch (species) {
		case duck:
		case chicken:
			return 'yellow';
		case goose:
		case ghost:
		case rabbit:
		case snowman:
			return 'white';
		case blob:
		case octopus:
		case axolotl:
		case unicorn:
			return 'magentaBright';
		case cat:
		case capybara:
		case hamster:
		case chonk:
			return 'yellowBright';
		case dragon:
		case turtle:
		case cactus:
			return 'green';
		case owl:
		case snail:
		case mushroom:
		case raccoon:
			return 'gray';
		case penguin:
		case panda:
			return 'whiteBright';
		case robot:
		case laptop:
			return 'cyan';
		case fox:
			return 'red';
		case whale:
			return 'blue';
		case teapot:
		case treasure:
		case book:
		case coffee:
		case basketball:
			return 'yellow';
		case rocket:
		case moon:
			return 'whiteBright';
		case cloud:
			return 'cyanBright';
		case lantern:
		case star:
			return 'yellowBright';
	}
}

const BODIES: Record<Species, string[][]> = {
	[duck]: [
		[
			'            ',
			'    __      ',
			'  <({E} )___  ',
			'   (  ._>   ',
			'    `--´    ',
		],
		[
			'            ',
			'    __      ',
			'  <({E} )___  ',
			'   (  ._>   ',
			'    `--´~   ',
		],
		[
			'            ',
			'    __      ',
			'  <({E} )___  ',
			'   (  .__>  ',
			'    `--´    ',
		],
	],
	[goose]: [
		[
			'            ',
			'     ({E}>    ',
			'     ||     ',
			'   _(__)_   ',
			'    ^^^^    ',
		],
		[
			'            ',
			'    ({E}>     ',
			'     ||     ',
			'   _(__)_   ',
			'    ^^^^    ',
		],
		[
			'            ',
			'     ({E}>>   ',
			'     ||     ',
			'   _(__)_   ',
			'    ^^^^    ',
		],
	],
	[chicken]: [
		[
			'            ',
			'    __      ',
			'  _({E})>    ',
			'  (  v )    ',
			'   ^^ ^^    ',
		],
		[
			'            ',
			'    __      ',
			'  _({E})>    ',
			'  (  V )    ',
			'   ^^ ^^    ',
		],
		[
			'    ,       ',
			'    __      ',
			'  _({E})>>   ',
			'  (  v )    ',
			'   ^^ ^^    ',
		],
	],
	[blob]: [
		[
			'            ',
			'   .----.   ',
			'  ( {E}  {E} )  ',
			'  (      )  ',
			'   `----´   ',
		],
		[
			'            ',
			'  .------.  ',
			' (  {E}  {E}  ) ',
			' (        ) ',
			'  `------´  ',
		],
		[
			'            ',
			'    .--.    ',
			'   ({E}  {E})   ',
			'   (    )   ',
			'    `--´    ',
		],
	],
	[cat]: [
		[
			'            ',
			'   /\\_/\\    ',
			'  ( {E}   {E})  ',
			'  (  ω  )   ',
			'  (")_(")   ',
		],
		[
			'            ',
			'   /\\_/\\    ',
			'  ( {E}   {E})  ',
			'  (  ω  )   ',
			'  (")_(")~  ',
		],
		[
			'            ',
			'   /\\-/\\    ',
			'  ( {E}   {E})  ',
			'  (  ω  )   ',
			'  (")_(")   ',
		],
	],
	[dragon]: [
		[
			'            ',
			'  /^\\  /^\\  ',
			' <  {E}  {E}  > ',
			' (   ~~   ) ',
			'  `-vvvv-´  ',
		],
		[
			'            ',
			'  /^\\  /^\\  ',
			' <  {E}  {E}  > ',
			' (        ) ',
			'  `-vvvv-´  ',
		],
		[
			'   ~    ~   ',
			'  /^\\  /^\\  ',
			' <  {E}  {E}  > ',
			' (   ~~   ) ',
			'  `-vvvv-´  ',
		],
	],
	[octopus]: [
		[
			'            ',
			'   .----.   ',
			'  ( {E}  {E} )  ',
			'  (______)  ',
			'  /\\/\\/\\/\\  ',
		],
		[
			'            ',
			'   .----.   ',
			'  ( {E}  {E} )  ',
			'  (______)  ',
			'  \\/\\/\\/\\/  ',
		],
		[
			'     o      ',
			'   .----.   ',
			'  ( {E}  {E} )  ',
			'  (______)  ',
			'  /\\/\\/\\/\\  ',
		],
	],
	[owl]: [
		[
			'            ',
			'   /\\  /\\   ',
			'  (({E})({E}))  ',
			'  (  ><  )  ',
			'   `----´   ',
		],
		[
			'            ',
			'   /\\  /\\   ',
			'  (({E})({E}))  ',
			'  (  ><  )  ',
			'   .----.   ',
		],
		[
			'            ',
			'   /\\  /\\   ',
			'  (({E})(-))  ',
			'  (  ><  )  ',
			'   `----´   ',
		],
	],
	[penguin]: [
		[
			'            ',
			'  .---.     ',
			'  ({E}>{E})     ',
			' /(   )\\    ',
			'  `---´     ',
		],
		[
			'            ',
			'  .---.     ',
			'  ({E}>{E})     ',
			' |(   )|    ',
			'  `---´     ',
		],
		[
			'  .---.     ',
			'  ({E}>{E})     ',
			' /(   )\\    ',
			'  `---´     ',
			'   ~ ~      ',
		],
	],
	[turtle]: [
		[
			'            ',
			'   _,--._   ',
			'  ( {E}  {E} )  ',
			' /[______]\\ ',
			'  ``    ``  ',
		],
		[
			'            ',
			'   _,--._   ',
			'  ( {E}  {E} )  ',
			' /[______]\\ ',
			'   ``  ``   ',
		],
		[
			'            ',
			'   _,--._   ',
			'  ( {E}  {E} )  ',
			' /[======]\\ ',
			'  ``    ``  ',
		],
	],
	[snail]: [
		[
			'            ',
			' {E}    .--.  ',
			'  \\  ( @ )  ',
			'   \\_`--´   ',
			'  ~~~~~~~   ',
		],
		[
			'            ',
			'  {E}   .--.  ',
			'  |  ( @ )  ',
			'   \\_`--´   ',
			'  ~~~~~~~   ',
		],
		[
			'            ',
			' {E}    .--.  ',
			'  \\  ( @  ) ',
			'   \\_`--´   ',
			'   ~~~~~~   ',
		],
	],
	[ghost]: [
		[
			'            ',
			'   .----.   ',
			'  / {E}  {E} \\  ',
			'  |      |  ',
			'  ~`~``~`~  ',
		],
		[
			'            ',
			'   .----.   ',
			'  / {E}  {E} \\  ',
			'  |      |  ',
			'  `~`~~`~`  ',
		],
		[
			'    ~  ~    ',
			'   .----.   ',
			'  / {E}  {E} \\  ',
			'  |      |  ',
			'  ~~`~~`~~  ',
		],
	],
	[axolotl]: [
		[
			'            ',
			'}~(______)~{',
			'}~({E} .. {E})~{',
			'  ( .--. )  ',
			'  (_/  \\_)  ',
		],
		[
			'            ',
			'~}(______){~',
			'~}({E} .. {E}){~',
			'  ( .--. )  ',
			'  (_/  \\_)  ',
		],
		[
			'            ',
			'}~(______)~{',
			'}~({E} .. {E})~{',
			'  (  --  )  ',
			'  ~_/  \\_~  ',
		],
	],
	[capybara]: [
		[
			'            ',
			'  n______n  ',
			' ( {E}    {E} ) ',
			' (   oo   ) ',
			'  `------´  ',
		],
		[
			'            ',
			'  n______n  ',
			' ( {E}    {E} ) ',
			' (   Oo   ) ',
			'  `------´  ',
		],
		[
			'    ~  ~    ',
			'  u______n  ',
			' ( {E}    {E} ) ',
			' (   oo   ) ',
			'  `------´  ',
		],
	],
	[cactus]: [
		[
			'            ',
			' n  ____  n ',
			' | |{E}  {E}| | ',
			' |_|    |_| ',
			'   |    |   ',
		],
		[
			'            ',
			'    ____    ',
			' n |{E}  {E}| n ',
			' |_|    |_| ',
			'   |    |   ',
		],
		[
			' n        n ',
			' |  ____  | ',
			' | |{E}  {E}| | ',
			' |_|    |_| ',
			'   |    |   ',
		],
	],
	[basketball]: [
		[
			'            ',
			'   .----.   ',
			'  /{E} || {E}\\  ',
			' |---++---| ',
			'  \\_ || _/  ',
		],
		[
			'            ',
			'   .----.   ',
			'  /{E} /\\ {E}\\  ',
			' |--<  >--| ',
			'  \\_/\\_/  ',
		],
		[
			'    dunk    ',
			'   .----.   ',
			'  /{E} || {E}\\  ',
			' |---++---| ',
			'  \\_ || _/  ',
		],
	],
	[robot]: [
		[
			'            ',
			'   .[||].   ',
			'  [ {E}  {E} ]  ',
			'  [ ==== ]  ',
			'  `------´  ',
		],
		[
			'            ',
			'   .[||].   ',
			'  [ {E}  {E} ]  ',
			'  [ -==- ]  ',
			'  `------´  ',
		],
		[
			'     *      ',
			'   .[||].   ',
			'  [ {E}  {E} ]  ',
			'  [ ==== ]  ',
			'  `------´  ',
		],
	],
	[rabbit]: [
		[
			'            ',
			'   (\\__/)   ',
			'  ( {E}  {E} )  ',
			' =(  ..  )= ',
			'  (")__(")  ',
		],
		[
			'            ',
			'   (|__/)   ',
			'  ( {E}  {E} )  ',
			' =(  ..  )= ',
			'  (")__(")  ',
		],
		[
			'            ',
			'   (\\__/)   ',
			'  ( {E}  {E} )  ',
			' =( .  . )= ',
			'  (")__(")  ',
		],
	],
	[mushroom]: [
		[
			'            ',
			' .-o-OO-o-. ',
			'(__________)',
			'   |{E}  {E}|   ',
			'   |____|   ',
		],
		[
			'            ',
			' .-O-oo-O-. ',
			'(__________)',
			'   |{E}  {E}|   ',
			'   |____|   ',
		],
		[
			'   . o  .   ',
			' .-o-OO-o-. ',
			'(__________)',
			'   |{E}  {E}|   ',
			'   |____|   ',
		],
	],
	[chonk]: [
		[
			'            ',
			'  /\\    /\\  ',
			' ( {E}    {E} ) ',
			' (   ..   ) ',
			'  `------´  ',
		],
		[
			'            ',
			'  /\\    /|  ',
			' ( {E}    {E} ) ',
			' (   ..   ) ',
			'  `------´  ',
		],
		[
			'            ',
			'  /\\    /\\  ',
			' ( {E}    {E} ) ',
			' (   ..   ) ',
			'  `------´~ ',
		],
	],
	[fox]: [
		[
			'            ',
			'  /\\___/\\  ',
			' ( {E}   {E} ) ',
			' (  ==v== ) ',
			'  `-uu-u´~ ',
		],
		[
			'            ',
			'  /\\___/|  ',
			' ( {E}   {E} ) ',
			' (  ==v== ) ',
			' ~`-uu-u´  ',
		],
		[
			'   *        ',
			'  /\\___/\\  ',
			' ( {E}   {E} ) ',
			' (  ==^== ) ',
			'  `-uu-u´~ ',
		],
	],
	[panda]: [
		[
			'            ',
			'  .-.__.-.  ',
			' (o {E} {E} o) ',
			' (   __   ) ',
			'  `-(__)-´  ',
		],
		[
			'            ',
			'  .-.__.-.  ',
			' (O {E} {E} o) ',
			' (   __   ) ',
			'  `-(__)-´  ',
		],
		[
			'            ',
			'  .-.__.-.  ',
			' (o {E} {E} O) ',
			' (  ____  ) ',
			'  `-(__)-´  ',
		],
	],
	[raccoon]: [
		[
			'            ',
			'  /\\_M_/\\  ',
			' (#{E} {E}#) ',
			' (  .--.  ) ',
			'  `-m--m´~ ',
		],
		[
			'            ',
			'  /\\_W_/\\  ',
			' (#{E} {E}#) ',
			' (  .--.  ) ',
			' ~`-m--m´  ',
		],
		[
			'   .  .     ',
			'  /\\_M_/\\  ',
			' (#{E} {E}#) ',
			' (  ----  ) ',
			'  `-m--m´~ ',
		],
	],
	[unicorn]: [
		[
			'    /\\      ',
			'  /\\__/\\   ',
			' ( {E}  {E} )  ',
			' (  ~~~  ) ',
			'  `-vvv-´  ',
		],
		[
			'    //      ',
			'  /\\__/\\   ',
			' ( {E}  {E} )  ',
			' (  ~~~  ) ',
			'  `-v-v-´  ',
		],
		[
			'  . /\\ .    ',
			'  /\\__/\\   ',
			' ( {E}  {E} )  ',
			' (  ***  ) ',
			'  `-vvv-´  ',
		],
	],
	[whale]: [
		[
			'     __     ',
			'  __/  \\__  ',
			' / {E}    {E} \\ ',
			' \\__    __/ ',
			'    `~~´    ',
		],
		[
			'   . __ .   ',
			'  __/  \\__  ',
			' / {E}    {E} \\ ',
			' \\__    __/ ',
			'    `~~´    ',
		],
		[
			'    __  o   ',
			'  __/  \\__  ',
			' / {E}    {E} \\ ',
			' \\__~~~~__/ ',
			'    `~~´    ',
		],
	],
	[hamster]: [
		[
			'            ',
			'  (\\___/)  ',
			' ( {E}   {E} ) ',
			' (  >oo<  ) ',
			'  `-(__)-´ ',
		],
		[
			'            ',
			'  (\\___/)  ',
			' ( {E}   {E} ) ',
			' (  >OO<  ) ',
			'  `-(__)-´ ',
		],
		[
			'   crumbs   ',
			'  (\\___/)  ',
			' ( {E}   {E} ) ',
			' (  >.. < ) ',
			'  `-(__)-´ ',
		],
	],
	[teapot]: [
		[
			'    ___     ',
			'   (___)    ',
			'  / {E} {E}\\__ ',
			' (   ~~  _ )',
			'  `-____-´  ',
		],
		[
			'     ~      ',
			'   (___)    ',
			'  / {E} {E}\\__ ',
			' (   ~~  _ )',
			'  `-____-´  ',
		],
		[
			'   ~   ~    ',
			'   (___)    ',
			'  / {E} {E}\\__ ',
			' (   ..  _ )',
			'  `-____-´  ',
		],
	],
	[rocket]: [
		[
			'     /\\     ',
			'    /  \\    ',
			'   |{E}{E}|   ',
			'   |____|   ',
			'    //\\    ',
		],
		[
			'     /\\     ',
			'    /  \\    ',
			'   |{E}{E}|   ',
			'   |____|   ',
			'    /^^\\    ',
		],
		[
			'     /\\     ',
			'    /  \\    ',
			'   |{E}{E}|   ',
			'   |____|   ',
			'    *  *    ',
		],
	],
	[laptop]: [
		[
			'            ',
			'  .------.  ',
			'  | {E}{E} |  ',
			'  |  __  |  ',
			'  `-====-´  ',
		],
		[
			'            ',
			'  .------.  ',
			'  | {E}{E} |  ',
			'  |  --  |  ',
			'  `-====-´  ',
		],
		[
			'    ping    ',
			'  .------.  ',
			'  | {E}{E} |  ',
			'  |  <>  |  ',
			'  `-====-´  ',
		],
	],
	[moon]: [
		[
			'            ',
			'   .----.   ',
			'  / {E} {E})   ',
			' (   ..  )  ',
			'  `----´   ',
		],
		[
			'      *     ',
			'   .----.   ',
			'  / {E} {E})   ',
			' (   oo  )  ',
			'  `----´   ',
		],
		[
			'   *        ',
			'   .----.   ',
			'  / {E} -)   ',
			' (   ..  )  ',
			'  `----´   ',
		],
	],
	[cloud]: [
		[
			'            ',
			'   .--.     ',
			' .({E} {E}).  ',
			'(        ) ',
			' `------´  ',
		],
		[
			'            ',
			'  .----.    ',
			' ({E}  {E}).. ',
			'(        ) ',
			' `------´  ',
		],
		[
			'   drip     ',
			'   .--.     ',
			' .({E} {E}).  ',
			'(        ) ',
			'  `----´   ',
		],
	],
	[lantern]: [
		[
			'    __      ',
			'   [__]     ',
			'  /{E} {E}\\    ',
			'  |  **|    ',
			'  `----´    ',
		],
		[
			'    __      ',
			'   [__]     ',
			'  /{E} {E}\\    ',
			'  |  ++|    ',
			'  `----´    ',
		],
		[
			'   glow     ',
			'   [__]     ',
			'  /{E} {E}\\    ',
			'  |  **|    ',
			'  `----´    ',
		],
	],
	[treasure]: [
		[
			'            ',
			'  .------.  ',
			' / {E}  {E}\\ ',
			' |  $$$ |  ',
			' `-====-´  ',
		],
		[
			'    *       ',
			'  .------.  ',
			' / {E}  {E}\\ ',
			' |  $$$ |  ',
			' `-====-´  ',
		],
		[
			'       *    ',
			'  .------.  ',
			' / {E}  {E}\\ ',
			' |  ### |  ',
			' `-====-´  ',
		],
	],
	[book]: [
		[
			'            ',
			'  ________  ',
			' / {E}  {E}/| ',
			'|  lines | ',
			'|_______|/ ',
		],
		[
			'            ',
			'  ________  ',
			' / {E}  {E}/| ',
			'|  notes | ',
			'|_______|/ ',
		],
		[
			'   flip     ',
			'  ________  ',
			' / {E}  -/| ',
			'|  notes | ',
			'|_______|/ ',
		],
	],
	[star]: [
		[
			'     /\\     ',
			'  --/  \\--  ',
			'   > {E}{E} <   ',
			'  --\\__/--  ',
			'     /     ',
		],
		[
			'   . /\\ .   ',
			'  --/  \\--  ',
			'   > {E}{E} <   ',
			'  --\\__/--  ',
			'     /     ',
		],
		[
			'     /\\     ',
			'  --/  \\--  ',
			'   > {E}- <   ',
			'  --\\__/--  ',
			'   . / .   ',
		],
	],
	[coffee]: [
		[
			'     ~~     ',
			'   .----.   ',
			'  | {E}{E} |__',
			'  |  __  |  )',
			'  `------´  ',
		],
		[
			'    ~  ~    ',
			'   .----.   ',
			'  | {E}{E} |__',
			'  |  --  |  )',
			'  `------´  ',
		],
		[
			'   zzz      ',
			'   .----.   ',
			'  | -{E} |__',
			'  |  __  |  )',
			'  `------´  ',
		],
	],
	[snowman]: [
		[
			'    _i_     ',
			'   ({E} {E})    ',
			'   ( : )    ',
			'  (  :  )   ',
			'   `---´    ',
		],
		[
			'    _i_     ',
			'   ({E} {E})    ',
			'   ( - )    ',
			'  (  :  )   ',
			'   `---´    ',
		],
		[
			'   snow     ',
			'   ({E} -)    ',
			'   ( : )    ',
			'  (  :  )   ',
			'   `---´    ',
		],
	],
};

const HAT_LINES: Record<Hat, string> = {
	none: '',
	crown: '   \\^^^/    ',
	tophat: '   [___]    ',
	propeller: '    -+-     ',
	halo: '   (   )    ',
	wizard: '    /^\\     ',
	beanie: '   (___)    ',
	tinyduck: '    ,>      ',
	pirate: '   /###\\    ',
	flower: '   .-o-.    ',
	bucket: '   [___)    ',
	party: '    /!\\     ',
	visor: '   =====    ',
};

const PET_LINES: Record<Species, string[]> = {
	[duck]: ['  scritch  ', '  wing wig ', '  tail wag '],
	[goose]: [' neck rub  ', '  honk hum ', '  feather  '],
	[chicken]: ['  comb pat ', '  wing flap', '  peck hop '],
	[blob]: ['  squish   ', '  wobble   ', '  jiggle   '],
	[cat]: ['  chin rub ', '  purr purr', '  tail curl'],
	[dragon]: ['  scale rub', ' smoke puff', '  wing hum '],
	[octopus]: [' tentacle  ', '  bubble   ', '  soft pat '],
	[owl]: ['  head pat ', '  feather  ', '  blink hoot'],
	[penguin]: ['  belly pat', '  flipper  ', '  slide hop'],
	[turtle]: [' shell rub ', '  slow nod ', '  tiny step'],
	[snail]: [' shell buff', ' feeler wig', '  slime hop'],
	[ghost]: ['  spooky pat', '  soft boo ', '  drift hug'],
	[axolotl]: ['  gill rub ', '  water wig', '  happy gill'],
	[capybara]: ['  cozy rub ', '  nose boop', '  chill hum'],
	[cactus]: ['  safe pat ', ' flower nod', '  prickly ok'],
	[basketball]: ['  spin pat ', '  bounce   ', '  swish    '],
	[robot]: ['  tune up  ', '  beep purr', '  gear hum '],
	[rabbit]: ['  ear rub  ', '  nose wig ', '  hop hop  '],
	[mushroom]: [' cap brush ', '  spore puff', '  damp hum '],
	[chonk]: [' belly rub ', '  chonk hum', '  loaf wig '],
	[fox]: ['  ear scritch', '  tail swish', '  sly purr '],
	[panda]: ['  bamboo pat', '  paw wave ', '  munch hum'],
	[raccoon]: [' mask rub  ', '  paw grab ', '  trash joy'],
	[unicorn]: [' mane brush', '  horn glow', '  prance   '],
	[whale]: ['  wave pat ', '  splash   ', '  whale hum'],
	[hamster]: ['  cheek rub', '  tiny paws', '  wheel hop'],
	[teapot]: ['  lid pat  ', '  steam hum', '  warm sip '],
	[rocket]: ['  fin polish', '  boost hum', '  spark puff'],
	[laptop]: [' key taps  ', '  fan purr ', '  screen glow'],
	[moon]: ['  moon rub ', '  crater pat', '  tide hum '],
	[cloud]: ['  fluff pat', '  mist puff', '  floaty   '],
	[lantern]: [' glass wipe', '  warm glow', '  wick hum '],
	[treasure]: [' coin shine', '  latch pat', '  gem blink'],
	[book]: [' page brush', '  spine pat', '  quiet hum'],
	[star]: ['  star polish', '  twinkle  ', '  comet hop'],
	[coffee]: [' mug warm  ', '  steam pat', '  cozy sip '],
	[snowman]: ['  snow pat ', '  scarf tug', '  chilly hum'],
};

function spriteFramesFor(species: Species): string[][] {
	return (
		(BODIES as Partial<Record<Species, string[][]>>)[species] ?? BODIES[duck]
	);
}

function petLinesFor(species: Species): string[] {
	return (
		(PET_LINES as Partial<Record<Species, string[]>>)[species] ??
		PET_LINES[duck]
	);
}

export function renderSprite(bones: CompanionBones, frame = 0): string[] {
	const frames = spriteFramesFor(bones.species);
	const normalizedFrame = Math.max(0, frame) % frames.length;
	const body = frames[normalizedFrame]!.map(line =>
		line.replaceAll('{E}', bones.eye),
	);
	const lines = [...body];
	const hatLine = bones.hat === 'none' ? undefined : HAT_LINES[bones.hat];
	if (hatLine && !lines[0]!.trim()) {
		lines[0] = hatLine;
	}
	if (!lines[0]!.trim() && frames.every(f => !f[0]!.trim())) {
		lines.shift();
	}
	return lines;
}

export function renderPetSprite(bones: CompanionBones, frame = 0): string[] {
	const lines = renderSprite(bones, frame);
	const petLines = petLinesFor(bones.species);
	const normalizedFrame = Math.max(0, frame) % petLines.length;
	const petLine = petLines[normalizedFrame]!;
	const targetIndex = Math.max(0, lines.length - 1);
	lines[targetIndex] = petLine;
	return lines;
}

export function spriteFrameCount(species: Species): number {
	return spriteFramesFor(species).length;
}

export function renderFace(bones: CompanionBones): string {
	const eye: Eye = bones.eye;
	switch (bones.species) {
		case duck:
		case goose:
		case chicken:
			return `(${eye}>`;
		case blob:
			return `(${eye}${eye})`;
		case cat:
			return `=${eye}ω${eye}=`;
		case dragon:
			return `<${eye}~${eye}>`;
		case octopus:
			return `~(${eye}${eye})~`;
		case owl:
			return `(${eye})(${eye})`;
		case penguin:
			return `(${eye}>)`;
		case turtle:
			return `[${eye}_${eye}]`;
		case snail:
			return `${eye}(@)`;
		case ghost:
			return `/${eye}${eye}\\`;
		case axolotl:
			return `}${eye}.${eye}{`;
		case capybara:
			return `(${eye}oo${eye})`;
		case cactus:
			return `|${eye}  ${eye}|`;
		case robot:
			return `[${eye}${eye}]`;
		case rabbit:
			return `(${eye}..${eye})`;
		case mushroom:
			return `|${eye}  ${eye}|`;
		case chonk:
			return `(${eye}.${eye})`;
		case fox:
			return `=${eye}v${eye}=`;
		case panda:
			return `o${eye}_${eye}o`;
		case raccoon:
			return `#${eye}${eye}#`;
		case unicorn:
			return `/${eye}~${eye}`;
		case whale:
			return `/${eye}~~${eye}\\`;
		case hamster:
			return `(${eye}oo${eye})`;
		case teapot:
			return `/${eye}${eye}\\`;
		case rocket:
			return `|${eye}${eye}|`;
		case laptop:
			return `[${eye}${eye}]`;
		case moon:
			return `(${eye}.${eye})`;
		case cloud:
			return `(${eye}${eye})`;
		case lantern:
			return `/${eye}${eye}\\`;
		case treasure:
			return `/${eye}_${eye}\\`;
		case book:
			return `/${eye}${eye}/`;
		case star:
			return `<${eye}${eye}>`;
		case coffee:
			return `|${eye}${eye}|`;
		case basketball:
			return `(${eye}||${eye})`;
		case snowman:
			return `(${eye}_${eye})`;
	}
}
