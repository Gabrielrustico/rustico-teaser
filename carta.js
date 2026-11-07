/* Carta de Rusti-Co.: la usan la portada (index.html) y la carta de las mesas (carta/).
   Para cambiar platos, descripciones o fotos, edita solo este archivo.
   Los precios se actualizan solos varias veces al día desde Fudo (menu.json). */
const MENU_UPDATED = "25 de octubre de 2026";
const FUDO_MENU_URL = "https://menu.fu.do/rusti-co/qr-menu";
const MENU = {
  "Pizzas": {type:"pizzas", items:[
    ["Margarita",9900,"Pomodoro, fior di latte, albahaca y aceite de oliva.","margarita"],
    ["Pepperoni",13990,"Pomodoro, fior di latte y pepperoni.","pepperoni"],
    ["Napolitana",12990,"Pomodoro, fior di latte, cherrys horneados y jamón.","napolitana"],
    ["Hawaiana",13500,"Pomodoro, fior di latte, jamón y piña asada.","hawaiana"],
    ["Burrata",18990,"Pomodoro, fior di latte, mortadela de pistacho, burrata, pesto y pistacho.","burrata","Favorita"],
    ["Brisket",19900,"Pomodoro, fior di latte, brisket, pimentón asado, mermelada de brisket, ají verde, cebolla caramelizada y albahaca.","brisket"],
    ["Pesto",16990,"Base de pesto, fior di latte, cherrys horneados, prosciutto y grana padano.","pesto"],
    ["Capricciosa",16990,"Pomodoro, fior di latte, jamón, aceitunas sevillanas, champiñones, alcachofa y parmesano.","capricciosa","Nueva"],
    ["Rúcula",15900,"Pomodoro, fior di latte, rúcula, prosciutto, aceto balsámico reducido y grana padano.","rucula"],
    ["4 Quesos",15990,"Mascarpone, queso azul, fior di latte, ricotta y albahaca.","cuatroquesos"],
    ["Salmón",17900,"Fior di latte, mascarpone, salmón, cebolla morada, eneldo, limón y alcaparras.","salmon","Nueva"],
    ["Camarón",18500,"Bisque de camarón y bechamel, fior di latte, camarones, cebolla morada, perejil, limón y cherry.","camaron"],
    ["Vegetariana",13990,"Pomodoro, fior di latte, champiñones marinados, cherrys horneados, aceto reducido y albahaca.","vegetariana"],
    ["Mexicana",13990,"Pomodoro, fior di latte, carne molida, cebolla frita y ají verde.","mexicana"],
    ["Burger",13990,"Pomodoro, cheddar, carne molida, pepinillo, cebolla morada y tocino.","burger"],
    ["Árabe",13990,"Pomodoro, fior di latte, carne molida macerada en limón, cebolla morada y salsa labán.","arabe"],
  ]},
  "Para compartir": {type:"photos", items:[
    ["Palitos de queso",6990,"Siete palitos con salsa de ajo.","palitos"],
    ["Camembert al sartén",9900,"Camembert fundido en sartén de hierro, mermelada de pimentón y pan baguette con romero.","camembert"],
    ["Provoleta rústica",9900,"Provoleta a las finas hierbas, cherrys horneados y pan baguette al horno.","provoleta"],
    ["Prosciutto, mango y crema",10900,"Prosciutto o serrano, queso crema, rúcula, mango, miel y aceto reducido."],
    ["Burrata al horno",11500,"Pan baguette horneado con burrata, cherrys deshidratados, miel y albahaca."],
    ["Tártar de salmón",13500,"Salmón, palta, cebolla morada, alcaparras y limón.","tartar"],
    ["Crudo",15900,"200 g de carne de res con cebolla morada, pepinillos, ají verde, alcaparras, mayonesa y tostadas."],
  ]},
  "Panuozzos y ensaladas": {type:"photos", items:[
    ["Panuozzo Barros Luco",11990,"Masa de pizza, carne y queso mantecoso.","barrosluco"],
    ["Panuozzo pollo césar",11990,"Pollo, lechuga, salsa césar, parmesano y tomate cherry.","panuozzocesar"],
    ["Panuozzo italiano",11990,"Masa de pizza, carne, tomate, palta y mayonesa casera."],
    ["César rústica",10900,"Lechuga, cherrys, crutones, aceitunas, salsa césar, queso rallado y pollo.","cesar"],
    ["Palta burrata",12490,"Palta, tomate cherry, pesto, burrata y ralladura de limón."],
  ]},
  "Postres": {type:"photos", items:[
    ["Pizza Nutella",10900,"Nutella, plátano, frutilla y galleta Oreo.","nutella"],
    ["Tiramisú",5500,"Receta clásica de la casa.","tiramisu"],
    ["Panna cotta",4900,"Con salsa y tierra de galleta.","pannacotta"],
    ["Manjarate",4900,"El de siempre, al estilo Rusti-Co."],
  ]},
  "Coctelería": {type:"list", items:[
    ["Mojito N°7",9900,"De autor. Jack Daniel's, limón, syrup de romero, naranja, pomelo, albahaca y soda.",null,"De autor"],
    ["Rusti-Co Stout",9900,"De autor. Malibú, triple sec, limón y maracuyá, coronado con Kross Stout.",null,"De autor"],
    ["14 de Febrero",8900,"De autor. Malibú, cassis, frutilla, limón, marrasquino y espumante.",null,"De autor"],
    ["Pisco sour tradicional",6490,"Alto del Carmen reservado. De sabores: $6.900."],
    ["Pisco sour Catedral",7500,"De sabores: desde $8.500."],
    ["Mojito tradicional",6500,"De sabores: $7.500. Con Corona: $9.500."],
    ["Aperol spritz",6900,"Aperol, espumante y soda."],
    ["Gin tonic",6900,"Beefeater London Dry. De pepino o frutos rojos."],
    ["Espresso martini",6900,"Café espresso, Kahlúa y vodka."],
    ["Moscow mule",9900,"Vodka, limón, menta y Fentimans ginger beer."],
    ["Amaretto sour",7900,"Amaretto, limón, goma y albúmina."],
    ["Piña colada",7900,"Piña, ron, crema de leche y crema de coco."],
    ["Negroni",6500,"Gin, vermouth y Campari."],
    ["Caipiriña",6500,"De sabores: $7.900."],
  ]},
  "Cervezas": {type:"list", items:[
    ["Cocholgue Calafate",6500,"Schop 470 cc."],
    ["Cocholgue Ámbar",6500,"Schop 470 cc."],
    ["Fuzz Distorsión",6500,"Hazy IPA 6°, schop 470 cc."],
    ["Fuzz White Rabbit",6500,"Light ale 4°, schop 470 cc."],
    ["Porteña Flora Nativa",6500,"Calafate 5,5°, schop 470 cc."],
    ["Chiflón del Diablo",6500,"Scottish ámbar, schop 470 cc."],
    ["Pröcer Not Juice",7500,"Hazy IPA, schop 470 cc."],
    ["Mure La Gringa",5900,"American lager 4,6°, schop 470 cc."],
    ["Delirium Tremens",6900,"También Delirium Red."],
    ["Guinness Stout",5900,"440 cc."],
    ["Kunstmann Torobayo",4500,""],
    ["Austral Calafate",4900,""],
  ]},
  "Sin alcohol": {type:"list", items:[
    ["Limonada",3900,"Menta jengibre: $4.500. De sabores: $4.900."],
    ["Jugos naturales",3900,"Frambuesa, frutilla o piña. Mango o maracuyá: $4.900."],
    ["Mojito sin alcohol",4900,"De sabores: $5.900."],
    ["Piña colada 0°",6500,"También frambuesa colada."],
    ["Cerveza 0°",3900,"Budweiser, Heineken o Royal Guard."],
    ["Bebidas",2500,"350 cc."],
    ["Café espresso",2000,"Capuchino: $3.500. Latte: $4.200."],
  ]},
};

/* Carta de las mesas (carta/): orden de las pizzas y frases de sabor */
const PIZZAS_FAVORITAS = ["Burrata","Brisket","Camarón","Salmón"];   // van primero, con foto grande
const PIZZAS_CLASICAS = ["Margarita","Pepperoni","Napolitana","Hawaiana","4 Quesos","Capricciosa","Vegetariana","Mexicana","Burger","Árabe"];
// Las pizzas que no están en ninguna de las dos listas quedan en "De la casa".
const SABOR = {
  "Burrata":"Cremosa y fresca, con el crocante del pistacho.",
  "Brisket":"Carne tierna y jugosa, entre dulce y picante.",
  "Camarón":"Sabor a mar: base de bisque, cremosa, con limón que la refresca.",
  "Salmón":"Suave y cremosa, con el toque ácido del limón y las alcaparras.",
};
const ACOMPANAR = "Un Pisco sour Catedral o un schop Cocholgue bien helado.";

/* Nombre en la web -> nombre del producto en Fudo, cuando no coinciden */
const FUDO_ALIASES = {
  "Prosciutto, mango y crema":"Prosciuttos Mango y Crema",
  "Mojito N°7":"Mojito N°7 – Número de la Suerte",
  "Chiflón del Diablo":"Cerveza Scottish Ambar Chiflón del diablo",
  "Mure La Gringa":"Cerveza Mure la gringa",
  "Pisco sour tradicional":"Pisco Sour Tradicional",
  "Gin tonic":"Gin Tonic Tradicional",
  "Caipiriña":"Caipirina tradicional",
  "Cerveza 0°":"Budweiser 0°",
  "Bebidas":"Coca Cola",
  "Café espresso":"Cafe expresso",
  "Jugos naturales":"Jugo Frambuesa",
  "Mojito sin alcohol":"Mojito tradicional (sin alcohol)",
  "Guinness Stout":"Guinness Stout 4.2°",
};
const normName = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/^pizza (de )?/,"").replace(/[^a-z0-9]/g,"");

/* Aplica precios de menu.json: cambia el precio y saca lo que en Fudo está inactivo.
   Devuelve las claves de Fudo que ya aparecen en la carta. */
function aplicarPreciosFudo(data){
  const usadas = new Set();
  if (!data || !data.products) return usadas;
  for (const cat of Object.values(MENU)) {
    cat.items = cat.items.filter(it => {
      const k = normName(FUDO_ALIASES[it[0]] || it[0]), f = data.products[k];
      if (!f) return true;
      usadas.add(k);
      if (f.active === false) return false;
      it[1] = f.price; return true;
    });
  }
  return usadas;
}
