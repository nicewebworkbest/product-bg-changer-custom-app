require('isomorphic-fetch');
const dotenv = require('dotenv');
dotenv.config();
// const {default: Shopify, ApiVersion} = require('@shopify/shopify-api');
const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const serve = require('koa-static');
const mount = require('koa-mount');
const next = require('next');
const { default: createShopifyAuth } = require('@shopify/koa-shopify-auth');
const { verifyRequest } = require('@shopify/koa-shopify-auth');
const { ApiVersion } = require('@shopify/koa-shopify-graphql-proxy');
const session = require('koa-session');
const Router = require('koa-router');
const { receiveWebhook, registerWebhook } = require('@shopify/koa-shopify-webhooks');

const initDB = require('./server/src/database');
const addGlobalBackgroundSettings = require('./server/addGlobalBackgroundSettings');
const getGlobalBackgroundSettings = require('./server/getGlobalBackgroundSettings');
const removeGlobalBackgroundSettings = require('./server/removeGlobalBackgroundSettings');
const updateGlobalBackgroundSettings = require('./server/updateGlobalBackgroundSettings');
const addBackgroundSettings = require('./server/addBackgroundSettings');
const getBackgroundSettings = require('./server/getBackgroundSettings');
const removeBackgroundSettings = require('./server/removeBackgroundSettings');
const updateBackgroundSettings = require('./server/updateBackgroundSettings');

const removeImageBackground = require('./server/src/services/removeImageBackground');
const removeProductImage = require('./server/src/services/removeProductImage');
const uploadProductImage = require('./server/src/services/uploadProductImage');
const getImageMetafields = require('./server/src/services/getImageMetafields');
const getBackgroundColor = require('./server/src/services/getBackgroundColor');

const fs = require("fs");
const path = require("path");

const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Shopify.Context.initialize({
//   API_KEY: process.env.SHOPIFY_API_KEY,
//   API_SECRET_KEY: process.env.SHOPIFY_API_SECRET_KEY,
//   SCOPES: process.env.SHOPIFY_API_SCOPES.split(","),
//   HOST_NAME: process.env.HOST.replace(/https:\/\//, ""),
//   API_VERSION: ApiVersion.October20,
//   IS_EMBEDDED_APP: true,
//   SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
// });

const {
  SHOPIFY_API_SECRET_KEY,
  SHOPIFY_API_KEY,
  HOST,
  IMAGE_DIR_PATH
} = process.env;

app.prepare().then(() => {

  initDB();
  
  const server = new Koa();
  const router = new Router();
  server.use(session({ sameSite: 'none', secure: true }, server));
  server.keys = [SHOPIFY_API_SECRET_KEY];

  server.use(bodyParser());

  server.use(
    createShopifyAuth({
      apiKey: SHOPIFY_API_KEY,
      secret: SHOPIFY_API_SECRET_KEY,
      accessMode: 'offline',
      scopes: ['read_products', 'write_products'],
      async afterAuth(ctx) {
        const { shop, accessToken } = ctx.session;
        ctx.cookies.set("shopOrigin", shop, {
          httpOnly: false,
          secure: true,
          sameSite: 'none'
        });

        // Initialize Database
        const global_setting = await getGlobalBackgroundSettings(shop);
        if(global_setting.length) {
          updateGlobalBackgroundSettings({
            id: global_setting[0]._id,
            bgColor: '255,77,255,0',
            onoff: true,
            accessToken: accessToken
          });
        } else {
          addGlobalBackgroundSettings(shop, {
            bgColor: '255,77,255,0',
            onoff: true,
            accessToken: accessToken
          });
        }

        const additional_settings = await getBackgroundSettings(shop);
        if(additional_settings.length) {
          for(var i = 0; i < additional_settings.length; i++) {
            await removeBackgroundSettings({
              setting_id: additional_settings[i]._id
            });
          }
        }

        const productUpdateHookRegistration = await registerWebhook({
          address: `${HOST}/webhooks/products/create-update`,
          topic: 'PRODUCTS_UPDATE',
          accessToken,
          shop,
          apiVersion: ApiVersion.July20
        });

        if (productUpdateHookRegistration.success) {
          console.log('Successfully registered product update webhook!');
        } else {
          console.log('Failed to register product update webhook', productUpdateHookRegistration.result);
        }

				const productCreateHookRegistration = await registerWebhook({
          address: `${HOST}/webhooks/products/create-update`,
          topic: 'PRODUCTS_CREATE',
          accessToken,
          shop,
          apiVersion: ApiVersion.July20
        });

        if (productCreateHookRegistration.success) {
          console.log('Successfully registered product create webhook!');
        } else {
          console.log('Failed to register product create webhook', productCreateHookRegistration.result);
        }
        
        // ctx.redirect('/');
        ctx.redirect(`/?shop=${shop}`);
      }
    })
  );

  const webhook = receiveWebhook({ secret: SHOPIFY_API_SECRET_KEY });

  router.post('/webhooks/products/create-update', webhook, async (ctx) => {
		const productData = ctx.request.body;
		const productId = productData.id;
    const global_setting = await getGlobalBackgroundSettings(ctx.state.webhook.domain);
    const accessToken = global_setting[0].accessToken;
    const bgColor = await getBackgroundColor(ctx.state.webhook.domain, productData.vendor);
    console.log('bgColor', bgColor);
		console.log('productId', productId);

		for ( let index = 0; index < productData.images.length; index++ ) {
			let image = productData.images[index];
			let imageMetafields = await getImageMetafields(ctx, accessToken, image.id);
			let backgroundRemoved = imageMetafields.some(metafield => {
				return (metafield.key == 'removed_bg') && (metafield.value == 'yes');
			});
			console.log('backgroundRemoved', backgroundRemoved);

			if (!backgroundRemoved) {
				let fileName = await removeImageBackground(image.src, bgColor);
				uploadProductImage(ctx, accessToken, productId, image, fileName)
					.then((uploadedProductImage) => {
						removeProductImage(ctx, accessToken, productId, image.id);
						console.log('uploadedProductImage', uploadedProductImage);
					})
					.catch((err) => {
						console.log(err);
					});
			}
		}

		ctx.res.statusCode = 200;
  });

  router.get('/delete-images', async (req, res) => {
		const directory = IMAGE_DIR_PATH;

		fs.readdir(directory, (err, files) => {
			if (err) throw err;

			for (const file of files) {
				console.log( file );
				if (file == '.htaccess') continue;
				fs.unlink(path.join(directory, file), err => {
					if (err) throw err;
				});
			}
		});
    ctx.response.message = "All the images were removed!";
	});

  router.get('/get-global-background-settings', verifyRequest(), async (ctx) => {
    const { shop } = ctx.session;
    ctx.body = await getGlobalBackgroundSettings(shop);
    ctx.res.statusCode = 200;
  });

  router.post('/add-global-background-settings', verifyRequest(), async (ctx) => {
    const { shop } = ctx.session;
    ctx.body = await addGlobalBackgroundSettings(shop, ctx.request.body);
    ctx.res.statusCode = 200;
  });

  router.post('/update-global-background-settings', verifyRequest(), async (ctx) => {
    ctx.body = await updateGlobalBackgroundSettings(ctx.request.body);
    ctx.res.statusCode = 200;
  });

  router.delete('/delete-global-background-settings', verifyRequest(), async (ctx) => {
    ctx.body = await removeGlobalBackgroundSettings(ctx.request.body);
    ctx.res.statusCode = 200;
  });

  router.get('/get-background-settings', verifyRequest(), async (ctx) => {
    const { shop } = ctx.session;
    ctx.body = await getBackgroundSettings(shop);
    ctx.res.statusCode = 200;
  });

  router.post('/add-background-settings', verifyRequest(), async (ctx) => {
    const { shop } = ctx.session;
    ctx.body = await addBackgroundSettings(shop, ctx.request.body);
    ctx.res.statusCode = 200;
  });

  router.post('/update-background-settings', verifyRequest(), async (ctx) => {
    ctx.body = await updateBackgroundSettings(ctx.request.body);
    ctx.res.statusCode = 200;
  });

  router.delete('/delete-background-settings', verifyRequest(), async (ctx) => {
    ctx.body = await removeBackgroundSettings(ctx.request.body);
    ctx.res.statusCode = 200;
  });

  router.get('/(.*)', verifyRequest(), async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  });

  server.use( mount( '/' + IMAGE_DIR_PATH, serve('./' + IMAGE_DIR_PATH) ) ) ;

  server.use(router.allowedMethods());
  server.use(router.routes());

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});