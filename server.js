require('isomorphic-fetch');
const dotenv = require('dotenv');
dotenv.config();
const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== 'production';
// const express = require('express');
// var router = express.Router();
// const bodyParser = require('body-parser');
// const app = express();

const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const serve  = require('koa-static')
const mount  = require('koa-mount')
//const next = require('next');
const { default: createShopifyAuth } = require('@shopify/koa-shopify-auth');
const { verifyRequest } = require('@shopify/koa-shopify-auth');
const session = require('koa-session');
const { default: graphQLProxy } = require('@shopify/koa-shopify-graphql-proxy');
const { ApiVersion } = require('@shopify/koa-shopify-graphql-proxy');
const Router = require('koa-router');
const { receiveWebhook, registerWebhook } = require('@shopify/koa-shopify-webhooks');
const initDB = require('./server/src/database');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Shopify = require('shopify-api-node');
const removeRegisteredWebhook = require('./server/services/removeRegisteredWebhook');
const removeImageBackground = require('./server/services/removeImageBackground');
const removeProductImage = require('./server/services/removeProductImage');
const uploadProductImage = require('./server/services/uploadProductImage');
const getImageMetafields = require('./server/services/getImageMetafields');
const changeProductVariantImage = require('./server/services/changeProductVariantImage');
const app = next({ dev });
const handle = app.getRequestHandler();

const {
  SHOPIFY_API_SECRET_KEY,
  SHOPIFY_API_KEY,
} = process.env;

const shopify = new Shopify({
  shopName: SHOPNAME,
  apiKey: SHOPIFY_API_KEY,
	password: SHOPIFY_API_PASSWORD
});

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
      scopes: ['read_products', 'write_products'],
      async afterAuth(ctx) {
        const { shop, accessToken } = ctx.session;
        ctx.cookies.set("shopOrigin", shop, {
          httpOnly: false,
          secure: true,
          sameSite: 'none'
        });

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

        ctx.redirect('/');
      }
    })
  );

	const webhook = receiveWebhook({ secret: SHOPIFY_API_SECRET_KEY });

	router.post('/webhooks/products/update', webhook, (ctx) => {
    const data = req.body.toString();
		const productData = JSON.parse(data);
		const productId = productData.id;
		console.log('productId', productId);

		for ( let index = 0; index < productData.images.length; index++ ) {
			let image = productData.images[index];
			console.log('image', image);
			let imageMetafields = await getImageMetafields(image.id);
			let backgroundRemoved = imageMetafields.some(metafield => {
				return (metafield.key == 'removed_bg') && (metafield.value == 'yes');
			});
			console.log('backgroundRemoved', backgroundRemoved);

			if (!backgroundRemoved) {
				let fileName = await removeImageBackground(image.src);
				uploadProductImage(productId, image, fileName)
					.then((uploadedProductImage) => {
						removeProductImage(productId, image.id);
						console.log('uploadedProductImage', uploadedProductImage);
					})
					.catch((err) => {
						console.log(err);
					});

				// for (let index = 0; index < image.variant_ids.length; index++) {
				// 	let productVariant = await changeProductVariantImage(uploadedProductImage.id, image.variant_ids[index]);
				// 	console.log(productVariant);
				// }
			}
		}

		res.sendStatus(200);
  });


	/* Delete all the images from the server */
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
		res.send('All the images were removed!');
	});

	router.get('/(.*)', verifyRequest(), async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  });

	app.use( mount( '/' + IMAGE_DIR_PATH, serve('./' + IMAGE_DIR_PATH) ) ) ;

  server.use(router.allowedMethods());
  server.use(router.routes());

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });

});
